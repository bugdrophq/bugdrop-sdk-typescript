import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../examples/hosted-fixture/worker.js';
import { readBackendBinding } from '../examples/hosted-fixture/backend-binding.js';
import { fixture, ORIGIN, KEY, capability } from './hosted-fixture-helpers.js';
afterEach(() => vi.restoreAllMocks());
async function session() {
  const f = fixture();
  f.env.SELF_SERVICE_BINDING = '1';
  f.env.BUGDROP_API_KEY = '';
  f.env.APPLICATION_ID = '';
  const response = await worker.fetch(
    new Request(ORIGIN + '/login', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: f.env.OPERATOR_PASSWORD }),
    }),
    f.env
  );
  expect(response.status).toBe(303);
  const cookie = response.headers.get('Set-Cookie')!.split(';')[0]!;
  const page = await worker.fetch(new Request(ORIGIN, { headers: { Cookie: cookie } }), f.env);
  const html = await page.text();
  const csrf = html.match(/name="csrf" value="([a-f0-9]{64})"/)?.[1];
  expect(csrf).toBeDefined();
  expect(html).not.toContain('id="open"');
  return { ...f, cookie, csrf: csrf!, id: cookie.split('=')[1]! };
}
async function bind(
  f: Awaited<ReturnType<typeof session>>,
  body: Record<string, string> = {},
  headers = {}
) {
  return worker.fetch(
    new Request(ORIGIN + '/backend-binding', {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: f.cookie,
        ...headers,
      },
      body: new URLSearchParams({
        csrf: f.csrf,
        application_id: 'app_new_canary',
        api_key: KEY,
        ...body,
      }),
    }),
    f.env
  );
}
describe('fixture backend self-service binding', () => {
  it('connects through the normal private form, encrypts server custody and exposes only the public App ID', async () => {
    const f = await session();
    const response = await bind(f);
    expect(response.status).toBe(303);
    const bindingCookie = response.headers.get('Set-Cookie')!;
    expect(bindingCookie).toContain('Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800');
    expect(bindingCookie).not.toContain(KEY);
    expect(bindingCookie).not.toContain('app_new_canary');
    const cookie = f.cookie + '; ' + bindingCookie.split(';')[0];
    const request = new Request(ORIGIN, { headers: { Cookie: cookie } });
    expect(await readBackendBinding(request, f.env, f.id)).toMatchObject({
      apiKey: KEY,
      applicationId: 'app_new_canary',
    });
    const html = await (await worker.fetch(request, f.env)).text();
    expect(html).toContain('data-application="app_new_canary"');
    expect(html).not.toContain(KEY);
    expect(JSON.stringify([...f.storage.values.values()])).not.toContain(KEY);
  });
  it('fails closed before issuer access when no backend is connected', async () => {
    const f = await session();
    const provider = vi.fn(async () => new Response('{}'));
    f.env.CAPABILITY_SERVICE = { fetch: provider };
    expect((await capability(f.env, { cookie: f.cookie, csrf: f.csrf })).status).toBe(502);
    expect(provider).not.toHaveBeenCalled();
  });
  it.each([
    { csrf: 'wrong' },
    { api_key: 'not-a-key' },
    { api_key: KEY.slice(0, -1) + 'B' },
    { application_id: '<script>' },
    { unexpected: 'x' },
  ])('rejects invalid binding %j', async (body) => {
    const f = await session();
    const response = await bind(f, body);
    expect(response.status).toBe(403);
    expect(response.headers.has('Set-Cookie')).toBe(false);
    expect(await response.text()).not.toContain(KEY);
  });
  it('rejects missing session and cross-origin forms', async () => {
    const f = await session();
    expect((await bind(f, {}, { Cookie: '' })).status).toBe(403);
    expect((await bind(f, {}, { Origin: 'https://attacker.invalid' })).status).toBe(403);
    expect((await bind(f, { api_key: 'x'.repeat(2049) })).status).toBe(403);
  });
  it('rejects copied, tampered, duplicate and expired encrypted bindings', async () => {
    const f = await session();
    const response = await bind(f);
    const bound = response.headers.get('Set-Cookie')!.split(';')[0]!;
    const request = (value: string) =>
      new Request(ORIGIN, { headers: { Cookie: f.cookie + '; ' + value } });
    expect(await readBackendBinding(request(bound), f.env, 'a'.repeat(64))).toBeNull();
    expect(await readBackendBinding(request(bound + 'x'), f.env, f.id)).toBeNull();
    expect(await readBackendBinding(request(bound + '; ' + bound), f.env, f.id)).toBeNull();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1800001);
    expect(await readBackendBinding(request(bound), f.env, f.id)).toBeNull();
  });
});
