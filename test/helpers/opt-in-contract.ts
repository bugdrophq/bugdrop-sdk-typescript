// Test-only executable contract oracle. Never imported by a public package.
import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto';
import fixture from '../../packages/contracts/fixtures/opt-in.v2.json';
import catalogFixture from '../../packages/contracts/fixtures/opt-in-catalog.v2.json';
import {
  parseSubmissionBinding,
  parseUsableSubmissionCapability,
} from '../../packages/contracts/src/index.js';

export const intentKeys = [
  'attemptId',
  'issuedAt',
  'expiresAt',
  'submissionId',
  'payloadDigest',
  'applicationId',
  'credentialId',
  'keyId',
  'installationGeneration',
  'endpoint',
  'deploymentDigest',
  'catalogDigest',
  'origin',
  'serverSdkVersion',
  'browserSdkVersion',
  'normalizedVersions',
] as const;
const versionKeys = ['sdkVersion', 'browserSdkVersion', 'widgetVersion', 'protocolVersion'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex = /^[0-9a-f]{64}$/;
const version = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/;
export type Intent = typeof fixture.request.intent;

function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new Error('invalid_contract');
}
function keys(
  value: unknown,
  expected: readonly string[]
): asserts value is Record<string, unknown> {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  requireValue(Object.getPrototypeOf(value) === Object.prototype);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireValue(Object.keys(descriptors).length === expected.length);
  requireValue(expected.every((key) => descriptors[key] && 'value' in descriptors[key]));
}
export function digest(domain: string, tuple: unknown): string {
  return createHash('sha256').update(`${domain}\0`).update(JSON.stringify(tuple)).digest('hex');
}
export function intentTuple(intent: Intent): unknown[] {
  return intentKeys.map((key) =>
    key === 'normalizedVersions'
      ? versionKeys.map(
          (field) => intent.normalizedVersions[field as keyof Intent['normalizedVersions']]
        )
      : intent[key]
  );
}
export function intentDigest(intent: Intent): string {
  return digest('bugdrop:metadata-intent:v2', intentTuple(intent));
}
export function requestSignature(
  intent: Intent,
  secret = fixture.authentication.authSecret
): string {
  return createHmac('sha256', Buffer.from(secret, 'base64url'))
    .update(`bugdrop:intent-request:v2\0POST\0${intent.endpoint}\0${intentDigest(intent)}`)
    .digest('base64url');
}
export function validateRequest(request: unknown, now: number, signature: string): Intent {
  keys(request, ['schemaVersion', 'intent']);
  requireValue(request.schemaVersion === 2);
  keys(request.intent, intentKeys);
  const i = request.intent as Intent;
  parseSubmissionBinding({ submissionId: i.submissionId, payloadDigest: i.payloadDigest });
  for (const key of ['attemptId', 'credentialId', 'installationGeneration'] as const)
    requireValue(uuid.test(i[key]));
  requireValue(Number.isSafeInteger(i.issuedAt) && i.issuedAt >= 0);
  requireValue(Number.isSafeInteger(i.expiresAt) && i.expiresAt === i.issuedAt + 60_000);
  requireValue(i.issuedAt <= now + 5_000 && now < i.expiresAt);
  requireValue(/^app_[A-Za-z0-9_-]{1,196}$/.test(i.applicationId));
  requireValue(
    Buffer.from(i.keyId, 'base64url').length === 16 &&
      Buffer.from(i.keyId, 'base64url').toString('base64url') === i.keyId
  );
  for (const key of ['deploymentDigest', 'catalogDigest'] as const) requireValue(hex.test(i[key]));
  requireValue(i.catalogDigest === catalogFixture.catalogDigest);
  for (const key of ['serverSdkVersion', 'browserSdkVersion'] as const)
    requireValue(version.test(i[key]) && i[key].length <= 64);
  for (const key of ['endpoint', 'origin'] as const)
    requireValue(i[key] === fixture.request.intent[key]);
  keys(i.normalizedVersions, versionKeys);
  const c = catalogFixture.catalog;
  requireValue(
    i.normalizedVersions.sdkVersion ===
      (c.server.includes(i.serverSdkVersion) ? i.serverSdkVersion : null)
  );
  requireValue(
    i.normalizedVersions.browserSdkVersion ===
      (c.browser.includes(i.browserSdkVersion) ? i.browserSdkVersion : null)
  );
  requireValue(
    i.normalizedVersions.widgetVersion === null && i.normalizedVersions.protocolVersion === 2
  );
  requireValue(signature === requestSignature(i));
  return i;
}
export function validateResponse(response: unknown, expected: Intent, now: number): void {
  keys(response, ['schemaVersion', 'capability', 'confirmation']);
  requireValue(response.schemaVersion === 2);
  keys(response.capability, ['schemaVersion', 'token', 'expiresAt']);
  const capability = parseUsableSubmissionCapability(response.capability, now);
  requireValue(Buffer.byteLength(capability.token) <= 16_384);
  keys(response.confirmation, [
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
  const c = response.confirmation;
  requireValue(c.schemaVersion === 2 && c.kid === fixture.response.confirmation.kid);
  requireValue(c.intentDigest === intentDigest(expected));
  requireValue(
    c.capabilityDigest ===
      digest('bugdrop:capability-envelope:v2', [1, capability.token, capability.expiresAt])
  );
  requireValue(Number.isSafeInteger(c.admittedAt) && Number.isSafeInteger(c.expiresAt));
  requireValue(Number.isSafeInteger(c.reservedAt) && Number.isSafeInteger(c.retentionDeadline));
  requireValue(Number(c.reservedAt) >= Math.max(0, expected.issuedAt - 5000));
  requireValue(Number(c.reservedAt) <= Number(c.admittedAt));
  requireValue(c.retentionDeadline === Number(c.reservedAt) + 720 * 3600_000);
  requireValue(
    Number(c.admittedAt) >= expected.issuedAt - 5000 && Number(c.admittedAt) < expected.expiresAt
  );
  requireValue(
    Number(c.admittedAt) <= now + 5000 &&
      c.expiresAt === expected.expiresAt &&
      now < Number(c.expiresAt)
  );
  requireValue(typeof c.signature === 'string');
  const sig = Buffer.from(c.signature, 'base64url');
  requireValue(sig.length === 64 && sig.toString('base64url') === c.signature);
  const tuple = [
    2,
    c.kid,
    c.intentDigest,
    c.capabilityDigest,
    c.reservedAt,
    c.retentionDeadline,
    c.admittedAt,
    c.expiresAt,
  ];
  requireValue(
    verify(
      'sha256',
      Buffer.from(`bugdrop:metadata-confirmation:v2\0${JSON.stringify(tuple)}`),
      {
        key: createPublicKey({ key: fixture.confirmationPublicKey, format: 'jwk' }),
        dsaEncoding: 'ieee-p1363',
      },
      sig
    )
  );
}

// Public scalar d=1 is an intentionally non-secret test key, never a service key.
export function signedResponse(expected: Intent, admittedAt: number, reservedAt = admittedAt) {
  const response = structuredClone(fixture.response);
  const c = response.confirmation;
  c.intentDigest = intentDigest(expected);
  c.admittedAt = admittedAt;
  c.reservedAt = reservedAt;
  c.retentionDeadline = reservedAt + 720 * 3600_000;
  c.expiresAt = expected.expiresAt;
  const scalar = Buffer.alloc(32);
  scalar[31] = 1;
  const key = createPrivateKey({
    key: { ...fixture.confirmationPublicKey, d: scalar.toString('base64url') },
    format: 'jwk',
  });
  const tuple = [
    2,
    c.kid,
    c.intentDigest,
    c.capabilityDigest,
    c.reservedAt,
    c.retentionDeadline,
    c.admittedAt,
    c.expiresAt,
  ];
  c.signature = sign(
    'sha256',
    Buffer.from(`bugdrop:metadata-confirmation:v2\0${JSON.stringify(tuple)}`),
    {
      key,
      dsaEncoding: 'ieee-p1363',
    }
  ).toString('base64url');
  return response;
}
