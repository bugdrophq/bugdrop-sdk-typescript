import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BugDropOptIn, BugDropOptInError } from '../packages/server/src/opt-in.js';
import {
  binding,
  browserMetadata,
  clock,
  fixture,
  options,
  response,
  responseHeaders,
  responsePayload,
} from '../packages/server/test/opt-in-fixture.js';
import {
  intentKeys,
  requestSignature,
  signedResponse,
  validateRequest,
  type Intent,
} from './helpers/opt-in-contract';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(clock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('server opt-in public entry and trusted configuration', () => {
  it('authenticates the actual complete generated intent with the frozen independent oracle', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const r = JSON.parse(String(init?.body));
      expect(r.intent.attemptId).toMatch(/^[0-9a-f-]{36}$/);
      expect(r.intent.attemptId).not.toBe(fixture.request.intent.attemptId);
      const headers = new Headers(init?.headers);
      expect(validateRequest(r, clock, headers.get('X-BugDrop-Intent-Signature')!)).toEqual(
        r.intent
      );
      expect(headers.get('Authorization')).toBe(fixture.authentication.authorization);
      expect(headers.get('X-BugDrop-SDK-Version')).toBe('0.1.0');
      expect(init).toMatchObject({
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      });
      return response(init);
    });
    const client = new BugDropOptIn(options(fetch));
    expect(await client.createSubmissionCapability(binding, browserMetadata)).toEqual(
      fixture.response.capability
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(Object.keys(client)).toEqual([]);
    expect(JSON.stringify(client)).toBe('"[BugDrop opt-in server client]"');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    'applicationId',
    'credentialId',
    'keyId',
    'installationGeneration',
    'deploymentDigest',
    'catalogDigest',
    'endpoint',
    'origin',
    'apiKey',
  ])('rejects invalid configuration %s locally', (field) => {
    const fetch = vi.fn();
    expect(() => new BugDropOptIn({ ...options(fetch), [field]: 'invalid' })).toThrow(
      BugDropOptInError
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    'http://customer.example.test',
    'https://customer.example.test:443',
    'https://customer.example.test/',
    'https://customer.example.test.',
  ])('rejects non-canonical origin %s', (origin) => {
    expect(() => new BugDropOptIn({ ...options(vi.fn()), origin })).toThrow();
  });

  it('rejects legacy credentials, extra authority, invalid catalog/key material and missing fetch', () => {
    const original = options(vi.fn());
    const variants = [
      undefined,
      { ...original, apiKey: original.apiKey.replace('v2', 'v1') },
      { ...original, environment: 'production' },
      { ...original, catalog: { ...original.catalog, server: ['0.1.0', '0.1.0'] } },
      { ...original, confirmationKeys: [] },
      {
        ...original,
        confirmationKeys: [original.confirmationKeys[0], original.confirmationKeys[0]],
      },
      {
        ...original,
        confirmationKeys: [
          { kid: 'x', publicKey: { ...fixture.confirmationPublicKey, d: 'private' } },
        ],
      },
      { ...original, catalog: { ...original.catalog, schemaVersion: 2 } },
      { ...original, fetch: 'not a function' },
    ];
    for (const value of variants) expect(() => new BugDropOptIn(value as never)).toThrow();
    vi.stubGlobal('fetch', undefined);
    const { fetch: _fetch, ...noFetch } = original;
    expect(() => new BugDropOptIn(noFetch)).toThrow();
  });

  it('snapshots trusted configuration and accepts catalog-unknown claims as null', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const i = JSON.parse(String(init?.body)).intent;
      expect(i.normalizedVersions.browserSdkVersion).toBeNull();
      expect(i.applicationId).toBe(fixture.request.intent.applicationId);
      return response(init);
    });
    const config = options(fetch);
    const client = new BugDropOptIn(config);
    config.applicationId = 'app_changed';
    (config.catalog.browser as string[]).push('0.9.0');
    await expect(
      client.createSubmissionCapability(binding, { metadataVersion: 1, browserSdkVersion: '0.9.0' })
    ).resolves.toBeDefined();
  });

  it.each([
    {},
    { ...binding, userId: 'private' },
    { ...binding, submissionId: '\ud800' },
    { ...binding, payloadDigest: 'bad' },
  ])('rejects malformed binding before send %#', async (value) => {
    const fetch = vi.fn();
    const client = new BugDropOptIn(options(fetch));
    await expect(
      client.createSubmissionCapability(value as never, browserMetadata)
    ).rejects.toMatchObject({ code: 'rejected_before_send' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    { metadataVersion: 2, browserSdkVersion: '0.2.0' },
    { metadataVersion: 1, browserSdkVersion: '01.2.0' },
    { ...browserMetadata, userId: 'private' },
  ])('rejects malformed browser metadata %#', async (metadata) => {
    const fetch = vi.fn();
    const client = new BugDropOptIn(options(fetch));
    await expect(
      client.createSubmissionCapability(binding, metadata as never)
    ).rejects.toMatchObject({ code: 'rejected_before_send' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed at runtime in a browser realm', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    expect(() => new BugDropOptIn(options(vi.fn()))).toThrow(
      'cannot be imported into browser code'
    );
  });
});

describe('independent signed confirmation and full binding failures', () => {
  it.each(intentKeys)('rejects issuer confirmation for changed intent %s', async (field) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const { intent } = JSON.parse(String(init?.body)) as { intent: Intent };
      const changed = intent as unknown as Record<string, unknown>;
      changed[field] = typeof changed[field] === 'number' ? Number(changed[field]) + 1 : 'changed';
      return new Response(JSON.stringify(signedResponse(intent, clock)), {
        headers: responseHeaders,
      });
    });
    await expect(
      new BugDropOptIn(options(fetch)).createSubmissionCapability(binding, browserMetadata)
    ).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(Object.keys(fixture.response.confirmation))(
    'rejects changed confirmation %s',
    async (field) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
        const payload = responsePayload(init);
        (payload.confirmation as Record<string, unknown>)[field] = 'tampered';
        return new Response(JSON.stringify(payload), { headers: responseHeaders });
      });
      await expect(
        new BugDropOptIn(options(fetch)).createSubmissionCapability(binding, browserMetadata)
      ).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
    }
  );

  it.each([-5000, 5000])(
    'accepts genuine issuer decision at supported relative skew %s',
    async (skew) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
        const { intent } = JSON.parse(String(init?.body));
        return new Response(JSON.stringify(signedResponse(intent, clock + skew)), {
          headers: responseHeaders,
        });
      });
      await expect(
        new BugDropOptIn(options(fetch)).createSubmissionCapability(binding, browserMetadata)
      ).resolves.toBeDefined();
    }
  );

  it('does not release modified capability bytes, downgrade envelopes or reflected errors', async () => {
    for (const status of [200, 400, 401, 403, 409, 410, 503]) {
      const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
        const payload = responsePayload(init);
        payload.capability.token += 'secret-canary';
        return new Response(JSON.stringify(payload), { status, headers: responseHeaders });
      });
      const error = await new BugDropOptIn(options(fetch))
        .createSubmissionCapability(binding, browserMetadata)
        .catch((e) => e);
      expect(error).toMatchObject({ code: 'exchange_unconfirmed' });
      expect(String(error)).not.toContain('secret-canary');
      expect(fetch).toHaveBeenCalledOnce();
    }
  });

  it('requires a body-bound V2 MAC rather than a relabeled V1 secret', () => {
    expect(requestSignature(fixture.request.intent)).toBe(fixture.authentication.requestSignature);
  });
});
