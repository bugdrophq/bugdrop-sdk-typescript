import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnonymousTokenProvider, createCustomerPolicyTokenProvider } from '@bugdrop/browser';
import { binding, capability, origin, path } from './helpers/adapter-fixture.js';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const setup = () => {
  vi.stubGlobal('location', { origin, protocol: 'https:' });
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(capability(), { headers: { 'Cache-Control': 'no-store' } })
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
describe('browser token providers', () => {
  it('anonymous omits cookies, CSRF and redirects; uses binding only', async () => {
    const fetch = setup();
    expect(await createAnonymousTokenProvider()(binding)).toMatchObject({
      schemaVersion: 1,
      token: 'fixture-token',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe(origin + path);
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      body: JSON.stringify(binding),
      headers: { 'Content-Type': 'application/json' },
    });
  });
  it('customer policy requires a distinct CSRF source and same-origin credentials', async () => {
    expect(() => createCustomerPolicyTokenProvider(undefined as never)).toThrow();
    const fetch = setup();
    await createCustomerPolicyTokenProvider(() => 'csrf-fixture', { path: '/custom' })(binding);
    expect(fetch.mock.calls[0]![0]).toBe(origin + '/custom');
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      credentials: 'same-origin',
      headers: { 'X-BugDrop-CSRF-Token': 'csrf-fixture' },
    });
    await expect(createCustomerPolicyTokenProvider(() => '')(binding)).rejects.toThrow(
      'Unable to authorize'
    );
  });
  it('rejects invalid origin, path, oversized binding and unknown fields', async () => {
    const fetch = setup();
    expect(() => createAnonymousTokenProvider({ path: '//evil' })).toThrow();
    for (const invalid of [
      { ...binding, userId: 'bad' },
      { ...binding, submissionId: 'a'.repeat(1025) },
      null,
      { submissionId: 1, payloadDigest: 'a' },
    ]) {
      await expect(createAnonymousTokenProvider()(invalid as never)).rejects.toThrow(
        'Unable to authorize'
      );
    }
    vi.stubGlobal('location', { origin: 'http://evil.example', protocol: 'http:' });
    await expect(createAnonymousTokenProvider()(binding)).rejects.toThrow('Unable to authorize');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects bad response headers, schema, size, bytes and status without retry', async () => {
    for (const response of [
      new Response('', { status: 500 }),
      Response.json(capability()),
      Response.json(
        { ...capability(), schemaVersion: 2 },
        { headers: { 'Cache-Control': 'no-store' } }
      ),
      new Response('a'.repeat(32769), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
      new Response(new Uint8Array([0xff]), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
      Response.json([], { headers: { 'Cache-Control': 'no-store' } }),
    ]) {
      const fetch = setup();
      fetch.mockResolvedValue(response);
      await expect(createAnonymousTokenProvider()(binding)).rejects.toThrow('Unable to authorize');
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
});
