import { randomUUID, verify } from 'node:crypto';
import metadata from '../package.json';
import {
  parseSubmissionBinding,
  parseUsableSubmissionCapability,
  type SubmissionBinding,
} from '../../contracts/src/index.js';
import { base64, hash, integer, record, requireValue, stableVersion } from './opt-in-values.js';
import type { OptInConfiguration } from './opt-in-config.js';

export const OPT_IN_MEDIA_TYPE = 'application/vnd.bugdrop.submission-capability.v2+json';
export interface BrowserMetadata {
  metadataVersion: 1;
  browserSdkVersion: string;
}

export function request(
  config: OptInConfiguration,
  binding: SubmissionBinding,
  metadataClaim: BrowserMetadata
) {
  const bound = record(binding, ['submissionId', 'payloadDigest']);
  const parsed = parseSubmissionBinding(bound);
  const m = record(metadataClaim, ['metadataVersion', 'browserSdkVersion']);
  requireValue(m.metadataVersion === 1);
  const serverSdkVersion = stableVersion(metadata.version);
  const browserSdkVersion = stableVersion(m.browserSdkVersion);
  const issuedAt = integer(Date.now());
  const intent = Object.freeze({
    attemptId: randomUUID(),
    issuedAt,
    expiresAt: integer(issuedAt + 60_000),
    ...parsed,
    applicationId: config.applicationId,
    credentialId: config.credentialId,
    keyId: config.keyId,
    installationGeneration: config.installationGeneration,
    endpoint: config.endpoint,
    deploymentDigest: config.deploymentDigest,
    catalogDigest: config.catalogDigest,
    origin: config.origin,
    serverSdkVersion,
    browserSdkVersion,
    normalizedVersions: Object.freeze({
      sdkVersion: config.catalog.server.includes(serverSdkVersion) ? serverSdkVersion : null,
      browserSdkVersion: config.catalog.browser.includes(browserSdkVersion)
        ? browserSdkVersion
        : null,
      widgetVersion: null,
      protocolVersion: 2,
    }),
  });
  const tuple = [
    intent.attemptId,
    intent.issuedAt,
    intent.expiresAt,
    intent.submissionId,
    intent.payloadDigest,
    intent.applicationId,
    intent.credentialId,
    intent.keyId,
    intent.installationGeneration,
    intent.endpoint,
    intent.deploymentDigest,
    intent.catalogDigest,
    intent.origin,
    intent.serverSdkVersion,
    intent.browserSdkVersion,
    [intent.normalizedVersions.sdkVersion, intent.normalizedVersions.browserSdkVersion, null, 2],
  ];
  const digest = hash('bugdrop:metadata-intent:v2', tuple);
  const body = JSON.stringify({ schemaVersion: 2, intent });
  requireValue(Buffer.byteLength(body) <= 32_768);
  const headers = {
    'Content-Type': 'application/json',
    Accept: OPT_IN_MEDIA_TYPE,
    'X-BugDrop-Contract-Version': '2',
    'X-BugDrop-SDK-Version': serverSdkVersion,
    Authorization: config.authorization,
    'X-BugDrop-Intent-Signature': config.sign(config.endpoint, digest),
  };
  requireValue(
    Buffer.byteLength(
      Object.entries(headers)
        .map(([k, v]) => `${k.toLowerCase()}:${v}\r\n`)
        .join('')
    ) <= 16_384
  );
  return { body, headers, intent, digest };
}
export type OptInRequest = ReturnType<typeof request>;

export function confirmation(payload: unknown, expected: OptInRequest, config: OptInConfiguration) {
  const now = integer(Date.now());
  requireValue(now >= expected.intent.issuedAt && now < expected.intent.expiresAt);
  const outer = record(payload, ['schemaVersion', 'capability', 'confirmation']);
  requireValue(outer.schemaVersion === 2);
  const cap = record(outer.capability, ['schemaVersion', 'token', 'expiresAt']);
  const capability = parseUsableSubmissionCapability(cap, now);
  requireValue(Buffer.byteLength(capability.token) <= 16_384);
  const c = record(outer.confirmation, [
    'schemaVersion',
    'kid',
    'intentDigest',
    'capabilityDigest',
    'reservedAt',
    'retentionDeadline',
    'admittedAt',
    'expiresAt',
    'signature',
  ]);
  requireValue(c.schemaVersion === 2 && typeof c.kid === 'string');
  const key = config.keys.get(c.kid);
  requireValue(key && c.intentDigest === expected.digest);
  requireValue(
    c.capabilityDigest ===
      hash('bugdrop:capability-envelope:v2', [1, capability.token, capability.expiresAt])
  );
  const reservedAt = integer(c.reservedAt),
    admittedAt = integer(c.admittedAt);
  requireValue(integer(c.retentionDeadline) === integer(reservedAt + 720 * 3600_000));
  requireValue(reservedAt >= expected.intent.issuedAt - 5000 && reservedAt <= admittedAt);
  requireValue(admittedAt < expected.intent.expiresAt && admittedAt <= now + 5000);
  requireValue(c.expiresAt === expected.intent.expiresAt);
  requireValue(
    verify(
      'sha256',
      Buffer.from(
        `bugdrop:metadata-confirmation:v2\0${JSON.stringify([
          2,
          c.kid,
          c.intentDigest,
          c.capabilityDigest,
          reservedAt,
          c.retentionDeadline,
          admittedAt,
          c.expiresAt,
        ])}`
      ),
      { key, dsaEncoding: 'ieee-p1363' },
      base64(c.signature, 64)
    )
  );
  return Object.freeze(capability);
}
