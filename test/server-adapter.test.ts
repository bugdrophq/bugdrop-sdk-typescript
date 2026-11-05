import { describe, expect, it, vi } from 'vitest';
import { createCapabilityHandler } from '@bugdrop/server/adapter';
import { binding, denied, options, origin, request, upstream } from './helpers/adapter-fixture.js';

describe('managed capability Web adapter', () => {
  it('exchanges once with production managed authority and confirmation', async () => {
    const fetch = upstream();
    const response = await createCapabilityHandler(options(fetch))(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ schemaVersion: 1, token: 'fixture-token' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://managed.bugdrop.dev/v1/submission-capabilities');
    expect(JSON.parse(init!.body as string)).toEqual({
      schemaVersion: 1,
      ...binding,
      origin,
      admission: 'managed-v1',
    });
  });
  it('is default off before body, policy or client initialization', async () => {
    const fetch = upstream();
    const policy = vi.fn();
    const result = await createCapabilityHandler({
      ...options(fetch),
      mode: 'customer-policy',
      policy,
      enabled: false,
      apiKey: undefined,
    })(request());
    expect(result.status).toBe(404);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(fetch).not.toHaveBeenCalled();
    expect(policy).not.toHaveBeenCalled();
  });
  it('requires explicit mode, a customer policy and canonical authority', () => {
    for (const patch of [
      { mode: undefined },
      { mode: 'customer-policy' },
      { origin: origin + '/' },
      { origin: 'http://example.com' },
      { path: '//evil' },
      { path: '/a?b' },
    ]) {
      expect(() => createCapabilityHandler({ ...options(), ...patch } as never)).toThrow();
    }
  });
  it('permits HTTP loopback and an exact custom path', async () => {
    const url = 'http://bugdrop.localhost:3000';
    const response = await createCapabilityHandler({
      ...options(),
      origin: url,
      path: '/custom',
      environment: 'staging',
    })(
      request(
        undefined,
        {
          headers: {
            Origin: url,
            'Content-Type': 'application/json',
            'Sec-Fetch-Site': 'same-origin',
          },
        },
        url + '/custom'
      )
    );
    expect(response.status).toBe(200);
  });
  it('requires strict policy true and freezes only the binding', async () => {
    for (const verdict of [false, undefined, 1, 'true']) {
      const fetch = upstream();
      const policy = vi.fn((_req, value) => {
        expect(Object.isFrozen(value)).toBe(true);
        expect(value).toEqual(binding);
        return verdict;
      });
      await denied(
        await createCapabilityHandler({
          ...options(fetch),
          mode: 'customer-policy',
          policy: policy as never,
        })(request())
      );
      expect(fetch).not.toHaveBeenCalled();
    }
    expect(
      (
        await createCapabilityHandler({
          ...options(),
          mode: 'customer-policy',
          policy: () => true,
        })(request())
      ).status
    ).toBe(200);
  });
  it('rejects unconfirmed managed response and errors without retries', async () => {
    for (const response of [
      Response.json({
        schemaVersion: 1,
        token: 'fixture',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      new Response('', { status: 429 }),
      new Response('bad'),
    ]) {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
      await denied(await createCapabilityHandler(options(fetch))(request()));
      expect(fetch).toHaveBeenCalledTimes(1);
    }
    await denied(await createCapabilityHandler({ ...options(), apiKey: 'invalid' })(request()));
  });
});
