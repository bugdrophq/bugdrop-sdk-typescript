import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fixture from '../packages/contracts/fixtures/opt-in.v2.json';
import catalogFixture from '../packages/contracts/fixtures/opt-in-catalog.v2.json';
import { parseSubmissionCapability } from '../packages/contracts/src/index.js';
import { BugDrop } from '../packages/server/src/index.js';
import {
  digest,
  intentDigest,
  intentKeys,
  intentTuple,
  requestSignature,
  validateRequest,
  validateResponse,
} from './helpers/opt-in-contract';

const now = fixture.request.intent.issuedAt + 1000;
describe('P0 V2 normative synthetic vectors (not runtime qualification)', () => {
  it('pins catalog, complete ordered intent, request MAC and signed confirmation', () => {
    const c = catalogFixture.catalog;
    expect(digest('bugdrop:version-catalog:v1', [1, 1, c.server, c.browser, c.widget])).toBe(
      catalogFixture.catalogDigest
    );
    expect(intentTuple(fixture.request.intent)).toEqual(fixture.intentTuple);
    expect(intentDigest(fixture.request.intent)).toBe(fixture.intentDigest);
    const auth = createHmac('sha256', Buffer.from(fixture.authentication.root, 'base64url'))
      .update(`bugdrop:auth:v2\0${fixture.authentication.keyId}`)
      .digest('base64url');
    expect(auth).toBe(fixture.authentication.authSecret);
    expect(requestSignature(fixture.request.intent)).toBe(fixture.authentication.requestSignature);
    expect(validateRequest(fixture.request, now, fixture.authentication.requestSignature)).toEqual(
      fixture.request.intent
    );
    expect(() => validateResponse(fixture.response, fixture.request.intent, now)).not.toThrow();
  });

  it.each(intentKeys)('authenticates and confirms changed intent field %s', (key) => {
    const request = structuredClone(fixture.request);
    const changed = request.intent as unknown as Record<string, unknown>;
    changed[key] = typeof changed[key] === 'number' ? Number(changed[key]) + 1 : 'changed';
    expect(intentDigest(request.intent)).not.toBe(fixture.intentDigest);
    expect(() => validateRequest(request, now, fixture.authentication.requestSignature)).toThrow();
    expect(() => validateResponse(fixture.response, request.intent, now)).toThrow();
  });

  it.each(['sdkVersion', 'browserSdkVersion', 'widgetVersion', 'protocolVersion'] as const)(
    'binds normalized field %s including null transitions',
    (key) => {
      const request = structuredClone(fixture.request);
      (request.intent.normalizedVersions as Record<string, unknown>)[key] = null;
      if (key === 'widgetVersion')
        (request.intent.normalizedVersions as Record<string, unknown>)[key] = '0.3.0';
      expect(intentDigest(request.intent)).not.toBe(fixture.intentDigest);
      expect(() => validateResponse(fixture.response, request.intent, now)).toThrow();
    }
  );

  it('normalizes a syntactically valid unknown exactly once, without accepting changed result', () => {
    const request = structuredClone(fixture.request);
    request.intent.browserSdkVersion = '0.9.0';
    (request.intent.normalizedVersions as Record<string, unknown>).browserSdkVersion = null;
    expect(() => validateRequest(request, now, requestSignature(request.intent))).not.toThrow();
    request.intent.normalizedVersions.browserSdkVersion = '0.9.0';
    expect(() => validateRequest(request, now, requestSignature(request.intent))).toThrow();
  });

  it.each([-5001, 60000, 60001])('rejects outside freshness boundary %s', (offset) => {
    expect(() =>
      validateRequest(
        fixture.request,
        fixture.request.intent.issuedAt + offset,
        fixture.authentication.requestSignature
      )
    ).toThrow();
  });

  it.each([
    'schemaVersion',
    'kid',
    'intentDigest',
    'capabilityDigest',
    'admittedAt',
    'expiresAt',
    'signature',
  ])('rejects tampered confirmation %s', (key) => {
    const response = structuredClone(fixture.response);
    const changed = response.confirmation as unknown as Record<string, unknown>;
    changed[key] = typeof changed[key] === 'number' ? Number(changed[key]) + 1 : 'changed';
    expect(() => validateResponse(response, fixture.request.intent, now)).toThrow();
  });

  it('rejects missing intent, extra fields, wrong schema and V2 key at old SDK boundary', () => {
    for (const request of [
      { schemaVersion: 2 },
      { ...fixture.request, extra: true },
      { ...fixture.request, schemaVersion: 1 },
    ]) {
      expect(() =>
        validateRequest(request, now, fixture.authentication.requestSignature)
      ).toThrow();
    }
    expect(
      () =>
        new BugDrop({
          apiKey: `bd_api_v2.${fixture.authentication.keyId}.${fixture.authentication.root}`,
        })
    ).toThrow();
    expect(() => parseSubmissionCapability(fixture.response)).toThrow();
    expect(() =>
      validateResponse({ ...fixture.response, extra: true }, fixture.request.intent, now)
    ).toThrow();
  });

  it('demonstrates old parser discards confirmation rather than verifies it', () => {
    const old = {
      ...fixture.response.capability,
      confirmation: { accepted: true, signature: 'forged' },
    };
    expect(parseSubmissionCapability(old)).toEqual(fixture.response.capability);
    expect(() => validateResponse(old, fixture.request.intent, now)).toThrow();
  });

  it('binds capability bytes and expiry; response loss is not a zero-mint oracle', () => {
    const response = structuredClone(fixture.response);
    response.capability.token += '-changed';
    expect(() => validateResponse(response, fixture.request.intent, now)).toThrow();
    expect(() => validateResponse(undefined, fixture.request.intent, now)).toThrow();
    // This verifier has no issuer state: no failure result purports to prove zero signatures.
  });
});
