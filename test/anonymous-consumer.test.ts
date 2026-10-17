import { afterEach, expect, it, vi } from 'vitest';
import { capabilityEndpoint } from '../examples/anonymous-consumer/server.js';
import { createAnonymousTokenProvider } from '../examples/v1-backend/transport.js';
import credential from '../packages/contracts/fixtures/api-key-credential.v1.json';
import fixture from '../packages/contracts/fixtures/submission-binding.v1.json';
const origin = 'https://another-owner-app.example';
const capability = {
  schemaVersion: 1,
  token: 'synthetic-capability',
  expiresAt: new Date(Date.now() + 240000).toISOString(),
};
const request = (site = 'same-origin') =>
  new Request(origin + '/api/bugdrop-capability/v1', {
    method: 'POST',
    headers: { Origin: origin, 'Sec-Fetch-Site': site, 'Content-Type': 'application/json' },
    body: JSON.stringify(fixture.bound),
  });
afterEach(() => vi.unstubAllGlobals());
it('requires explicit activation and durable admission without a visitor session', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(capability));
  const options = {
    enabled: false,
    apiKey: credential.apiKey,
    origin,
    endpoint: 'https://issuer.example/v1/submission-capabilities',
    fetch,
  };
  const admit = vi.fn(async () => true);
  expect((await capabilityEndpoint(options, admit)(request())).status).toBe(404);
  expect(admit).not.toHaveBeenCalled();
  const handler = capabilityEndpoint({ ...options, enabled: true }, admit);
  expect((await handler(request('cross-site'))).status).toBe(502);
  expect(fetch).not.toHaveBeenCalled();
  expect((await handler(request())).status).toBe(200);
  expect(admit).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
  admit.mockResolvedValue(false);
  expect((await handler(request())).status).toBe(502);
  expect(fetch).toHaveBeenCalledOnce();
});
it('omits visitor cookies and sends the original binding once', async () => {
  vi.stubGlobal('location', { origin, protocol: 'https:' });
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(JSON.stringify(capability), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      })
  );
  vi.stubGlobal('fetch', fetch);
  expect(await createAnonymousTokenProvider()(fixture.bound)).toEqual(capability);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    credentials: 'omit',
    redirect: 'error',
    body: JSON.stringify(fixture.bound),
  });
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).has('X-BugDrop-CSRF-Token')).toBe(false);
  fetch.mockRejectedValue(new Error('uncertain'));
  await expect(createAnonymousTokenProvider()(fixture.bound)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(2);
});
