import { createHmac, createPublicKey, type KeyObject } from 'node:crypto';
import {
  base64,
  hash,
  hex,
  https,
  record,
  requireValue,
  stableVersion,
  text,
  uuid,
} from './opt-in-values.js';

export interface VersionCatalog {
  schemaVersion: 1;
  normalizationVersion: 1;
  server: readonly string[];
  browser: readonly string[];
  widget: readonly string[];
}
export interface ConfirmationKey {
  kid: string;
  publicKey: { kty: 'EC'; crv: 'P-256'; x: string; y: string };
}
export interface BugDropOptInOptions {
  apiKey: string;
  endpoint: string;
  origin: string;
  applicationId: string;
  credentialId: string;
  keyId: string;
  installationGeneration: string;
  deploymentDigest: string;
  catalogDigest: string;
  catalog: VersionCatalog;
  confirmationKeys: readonly ConfirmationKey[];
  fetch?: typeof globalThis.fetch;
}

function versions(value: unknown): readonly string[] {
  requireValue(Array.isArray(value) && value.length <= 128);
  for (let index = 0; index < value.length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, index);
    requireValue(field && 'value' in field);
  }
  const copy = value.map(stableVersion);
  requireValue(copy.every((item, index) => index === 0 || item > copy[index - 1]!));
  return Object.freeze(copy);
}
function catalog(value: unknown, expected: string) {
  const c = record(value, ['schemaVersion', 'normalizationVersion', 'server', 'browser', 'widget']);
  requireValue(c.schemaVersion === 1 && c.normalizationVersion === 1);
  const result = {
    server: versions(c.server),
    browser: versions(c.browser),
    widget: versions(c.widget),
  };
  requireValue(
    hash('bugdrop:version-catalog:v1', [1, 1, result.server, result.browser, result.widget]) ===
      expected
  );
  return Object.freeze(result);
}
function keys(value: unknown): ReadonlyMap<string, KeyObject> {
  requireValue(Array.isArray(value) && value.length > 0 && value.length <= 128);
  const result = new Map<string, KeyObject>();
  for (const item of value) {
    const entry = record(item, ['kid', 'publicKey']);
    const kid = text(entry.kid);
    requireValue(/^[A-Za-z0-9_-]{1,64}$/.test(kid) && !result.has(kid));
    const jwk = record(entry.publicKey, ['kty', 'crv', 'x', 'y']);
    requireValue(jwk.kty === 'EC' && jwk.crv === 'P-256');
    base64(jwk.x, 32);
    base64(jwk.y, 32);
    result.set(
      kid,
      createPublicKey({
        key: { kty: 'EC', crv: 'P-256', x: text(jwk.x), y: text(jwk.y) },
        format: 'jwk',
      })
    );
  }
  return result;
}

export function configuration(input: BugDropOptInOptions) {
  const names = [
    'apiKey',
    'endpoint',
    'origin',
    'applicationId',
    'credentialId',
    'keyId',
    'installationGeneration',
    'deploymentDigest',
    'catalogDigest',
    'catalog',
    'confirmationKeys',
  ];
  const o = record(input, Object.hasOwn(input ?? {}, 'fetch') ? [...names, 'fetch'] : names);
  const [prefix, keyId, root, extra] = text(o.apiKey).split('.');
  requireValue(prefix === 'bd_api_v2' && extra === undefined && keyId === o.keyId);
  base64(keyId, 16);
  const secret = createHmac('sha256', base64(root, 32))
    .update(`bugdrop:auth:v2\0${keyId}`)
    .digest();
  const applicationId = text(o.applicationId);
  requireValue(/^app_[A-Za-z0-9_-]{1,196}$/.test(applicationId));
  const catalogDigest = hex(o.catalogDigest);
  requireValue(o.fetch === undefined || typeof o.fetch === 'function');
  const fetch = o.fetch ?? globalThis.fetch;
  requireValue(typeof fetch === 'function');
  return Object.freeze({
    endpoint: https(o.endpoint, true),
    origin: https(o.origin, false),
    applicationId,
    credentialId: uuid(o.credentialId),
    keyId: text(keyId),
    installationGeneration: uuid(o.installationGeneration),
    deploymentDigest: hex(o.deploymentDigest),
    catalogDigest,
    catalog: catalog(o.catalog, catalogDigest),
    keys: keys(o.confirmationKeys),
    authorization: `Bearer bd_auth_v2.${keyId}.${secret.toString('base64url')}`,
    sign: (endpoint: string, digest: string) =>
      createHmac('sha256', secret)
        .update(`bugdrop:intent-request:v2\0POST\0${endpoint}\0${digest}`)
        .digest('base64url'),
    fetch: fetch as typeof globalThis.fetch,
  });
}
export type OptInConfiguration = ReturnType<typeof configuration>;
