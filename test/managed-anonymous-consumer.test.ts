import { expect, it, vi } from 'vitest';
import { managedCapabilityEndpoint } from '../examples/anonymous-consumer/server.js';
import { BugDrop } from '../packages/server/src/index.js';
import credential from '../packages/contracts/fixtures/api-key-credential.v1.json';
import binding from '../packages/contracts/fixtures/submission-binding.v1.json';
import contract from '../packages/contracts/fixtures/managed-admission.v1.json';

const origin = 'https://app.example.com';
const capability = () => ({
  schemaVersion: 1,
  token: 'synthetic-capability',
  expiresAt: new Date(Date.now() + 240000).toISOString(),
});
const request = (site = 'same-origin', body = binding.bound) =>
  new Request(origin + '/api/bugdrop-capability/v1', {
    method: 'POST',
    headers: { Origin: origin, 'Sec-Fetch-Site': site, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
function sample(response: unknown = { ...capability(), admission: 'managed-v1' }) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(response));
  const options = { apiKey: credential.apiKey, origin, enabled: true, fetch };
  return { fetch, options, handler: managedCapabilityEndpoint(options) };
}
it('exchanges once using only an app key and strips the service confirmation before the widget', async () => {
  const s = sample();
  const response = await s.handler(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual(expect.objectContaining({ token: 'synthetic-capability' }));
  expect(s.fetch).toHaveBeenCalledOnce();
  const init = s.fetch.mock.calls[0]?.[1];
  expect(JSON.parse(String(init?.body))).toEqual(contract.request);
  expect(new Headers(init?.headers).get('Authorization')).toBe(credential.authorization);
});
it.each([undefined, null, 'managed-v0', false])(
  'fails closed without the exact service confirmation: %s',
  async (admission) => {
    const s = sample({ ...capability(), admission });
    const response = await s.handler(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('synthetic-capability');
    expect(s.fetch).toHaveBeenCalledOnce();
  }
);
it('never exchanges while disabled or on a cross-site browser request', async () => {
  const s = sample();
  expect(
    (await managedCapabilityEndpoint({ ...s.options, enabled: false })(request())).status
  ).toBe(404);
  expect((await s.handler(request('cross-site'))).status).toBe(502);
  expect((await s.handler(request(''))).status).toBe(502);
  expect(s.fetch).not.toHaveBeenCalled();
});
it('does not resend an uncertain exchange', async () => {
  const s = sample();
  s.fetch.mockRejectedValue(new Error('response lost'));
  expect((await s.handler(request())).status).toBe(502);
  expect(s.fetch).toHaveBeenCalledOnce();
});
it('cannot be downgraded through helper options and rejects unknown client admission contracts', async () => {
  const s = sample(capability());
  expect((await managedCapabilityEndpoint({ ...s.options })(request())).status).toBe(502);
  expect(
    () => new BugDrop({ apiKey: credential.apiKey, admission: 'unknown' as 'managed-v1' })
  ).toThrow('Unsupported');
});
