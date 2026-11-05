import { describe, expect, it, vi } from 'vitest';
import { createCapabilityHandler } from '@bugdrop/server/adapter';
import { capability, options, request } from './helpers/adapter-fixture.js';

// A supplied environment narrows authority by exact equality. Null authority
// accepts omission, not a deployment label invented by the caller.
function scopedIssuer(environment: string | null) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (Object.hasOwn(body, 'environment') && body.environment !== environment) {
      return Response.json(
        { schemaVersion: 1, error: { code: 'invalid_capability', retryable: false } },
        { status: 401 }
      );
    }
    return Response.json({ ...capability(), admission: 'managed-v1' });
  });
}

describe('managed adapter optional environment constraint', () => {
  it('leaves environment absent for null authority instead of inferring production', async () => {
    const fetch = scopedIssuer(null);
    const response = await createCapabilityHandler(options(fetch))(request());
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    expect(Object.hasOwn(body, 'environment')).toBe(false);
    expect(body.admission).toBe('managed-v1');
  });

  it.each(['production', 'staging'])(
    'preserves an explicit matching %s constraint',
    async (environment) => {
      const fetch = scopedIssuer(environment);
      const response = await createCapabilityHandler({ ...options(fetch), environment })(request());
      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).environment).toBe(environment);
    }
  );

  it.each([null, 'staging'])(
    'keeps an explicit mismatching constraint denied against %s',
    async (authorityEnvironment) => {
      const fetch = scopedIssuer(authorityEnvironment);
      const events: unknown[] = [];
      const response = await createCapabilityHandler({
        ...options(fetch),
        environment: 'production',
        observeFailure: (event) => {
          events.push(event);
        },
      })(request());
      expect(response.status).toBe(502);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(events).toEqual([
        { phase: 'issuer_exchange', reason: 'failed', issuerContacted: true, httpStatus: 401 },
      ]);
    }
  );
});
