import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BugDropOptIn } from '../packages/server/src/opt-in.js';
import {
  binding,
  browserMetadata,
  clock,
  options,
  resign,
  responseHeaders,
  responsePayload,
} from '../packages/server/test/opt-in-fixture.js';
import { signedResponse } from './helpers/opt-in-contract';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(clock);
});
afterEach(() => vi.useRealTimers());

describe('valid signatures are insufficient without exact lifetime and normalized intent', () => {
  it.each(['sdkVersion', 'browserSdkVersion', 'widgetVersion', 'protocolVersion'])(
    'rejects a signed mismatch in normalized field %s',
    async (field) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
        const { intent } = JSON.parse(String(init?.body));
        intent.normalizedVersions[field] = field === 'widgetVersion' ? '0.2.0' : null;
        return new Response(JSON.stringify(signedResponse(intent, clock)), {
          headers: responseHeaders,
        });
      });
      await expect(
        new BugDropOptIn(options(fetch)).createSubmissionCapability(binding, browserMetadata)
      ).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
      expect(fetch).toHaveBeenCalledOnce();
    }
  );

  it.each([
    ['reservedAt', clock - 5001],
    ['reservedAt', clock + 1],
    ['admittedAt', clock + 5001],
    ['admittedAt', clock + 60_000],
    ['retentionDeadline', clock + 720 * 3600_000 + 1],
    ['retentionDeadline', clock + 720 * 3600_000 - 1],
    ['expiresAt', clock + 60_001],
    ['reservedAt', 1.5],
  ] as const)('rejects correctly signed incoherent %s=%s', async (field, value) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const payload = responsePayload(init);
      payload.confirmation[field] = value;
      return new Response(JSON.stringify(resign(payload)), { headers: responseHeaders });
    });
    await expect(
      new BugDropOptIn(options(fetch)).createSubmissionCapability(binding, browserMetadata)
    ).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
  });

  it.each([
    'extra-envelope',
    'extra-capability',
    'extra-confirmation',
    'v1-envelope',
    'utf8-token',
    'overlong-expiry',
  ])('rejects %s even when a trusted key signs the commitment', async (fault) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const payload = responsePayload(init);
      if (fault === 'utf8-token') payload.capability.token = '界'.repeat(6000);
      if (fault === 'overlong-expiry')
        payload.capability.expiresAt = new Date(clock + 600_000).toISOString();
      resign(payload);
      if (fault === 'extra-envelope') Object.assign(payload, { extra: true });
      if (fault === 'extra-capability') Object.assign(payload.capability, { extra: true });
      if (fault === 'extra-confirmation') Object.assign(payload.confirmation, { extra: true });
      return new Response(JSON.stringify(fault === 'v1-envelope' ? payload.capability : payload), {
        headers: responseHeaders,
      });
    });
    await expect(
      new BugDropOptIn(options(fetch)).createSubmissionCapability(binding, browserMetadata)
    ).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
  });

  it('rejects response at exact original intent expiry instead of renewing it', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const payload = responsePayload(init);
      vi.setSystemTime(clock + 60_000);
      return new Response(JSON.stringify(payload), { headers: responseHeaders });
    });
    await expect(
      new BugDropOptIn(options(fetch)).createSubmissionCapability(binding, browserMetadata)
    ).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
  });
});
