// Synthetic tests only; nothing in this directory is published.
import fixture from '../../contracts/fixtures/opt-in.v2.json';
import catalogFixture from '../../contracts/fixtures/opt-in-catalog.v2.json';
import { signedResponse, type Intent } from '../../../test/helpers/opt-in-contract';
import type { BugDropOptInOptions } from '../src/opt-in-config.js';
import { createHash, createPrivateKey, sign } from 'node:crypto';

export { fixture, catalogFixture };
export const clock = fixture.request.intent.issuedAt;
export const binding = {
  submissionId: fixture.request.intent.submissionId,
  payloadDigest: fixture.request.intent.payloadDigest,
};
export const browserMetadata = { metadataVersion: 1 as const, browserSdkVersion: '0.2.0' };
export const responseHeaders = {
  'Content-Type': 'application/vnd.bugdrop.submission-capability.v2+json',
  'Cache-Control': 'no-store',
};
export function options(fetch: typeof globalThis.fetch): BugDropOptInOptions {
  const i = fixture.request.intent;
  return {
    apiKey: `bd_api_v2.${fixture.authentication.keyId}.${fixture.authentication.root}`,
    endpoint: i.endpoint,
    origin: i.origin,
    applicationId: i.applicationId,
    credentialId: i.credentialId,
    keyId: i.keyId,
    installationGeneration: i.installationGeneration,
    deploymentDigest: i.deploymentDigest,
    catalogDigest: i.catalogDigest,
    catalog: {
      ...structuredClone(catalogFixture.catalog),
      schemaVersion: 1,
      normalizationVersion: 1,
    },
    confirmationKeys: [
      {
        kid: fixture.response.confirmation.kid,
        publicKey: { ...fixture.confirmationPublicKey, kty: 'EC', crv: 'P-256' },
      },
    ],
    fetch,
  };
}
export function responsePayload(init: RequestInit | undefined) {
  const request = JSON.parse(String(init?.body)) as { intent: Intent };
  return signedResponse(request.intent, Date.now());
}
export function response(init: RequestInit | undefined): Response {
  return new Response(JSON.stringify(responsePayload(init)), { headers: responseHeaders });
}

export function resign(payload: ReturnType<typeof responsePayload>) {
  const c = payload.confirmation;
  c.capabilityDigest = createHash('sha256')
    .update('bugdrop:capability-envelope:v2\0')
    .update(JSON.stringify([1, payload.capability.token, payload.capability.expiresAt]))
    .digest('hex');
  const scalar = Buffer.alloc(32);
  scalar[31] = 1;
  const key = createPrivateKey({
    key: { ...fixture.confirmationPublicKey, d: scalar.toString('base64url') },
    format: 'jwk',
  });
  c.signature = sign(
    'sha256',
    Buffer.from(
      'bugdrop:metadata-confirmation:v2\0' +
        JSON.stringify([
          2,
          c.kid,
          c.intentDigest,
          c.capabilityDigest,
          c.reservedAt,
          c.retentionDeadline,
          c.admittedAt,
          c.expiresAt,
        ])
    ),
    { key, dsaEncoding: 'ieee-p1363' }
  ).toString('base64url');
  return payload;
}
