import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../examples/hosted-fixture/worker.js';
import { fixture, login, ORIGIN } from './hosted-fixture-helpers.js';

const sha = 'a'.repeat(40);
const get = (cookie?: string) =>
  new Request(`${ORIGIN}/heartbeat-identity`, { headers: cookie ? { Cookie: cookie } : {} });
afterEach(() => vi.restoreAllMocks());

describe('isolated monitoring fixture identity', () => {
  it('keeps disabled and historical fixtures inaccessible', async () => {
    const { env } = fixture();
    const session = await login(env);
    expect((await worker.fetch(get(session.cookie), env)).status).toBe(502);
    env.HEARTBEAT_BUILD = sha;
    env.FIXTURE_ENABLED = 'false';
    expect((await worker.fetch(get(session.cookie), env)).status).toBe(503);
  });
  it('requires the existing private session and discloses no key or CSRF', async () => {
    const { env } = fixture();
    env.HEARTBEAT_BUILD = sha;
    expect((await worker.fetch(get(), env)).status).toBe(502);
    const { cookie } = await login(env);
    const response = await worker.fetch(get(cookie), env);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      sdkCommit: sha,
      applicationId: env.APPLICATION_ID,
      widgetUrl: env.WIDGET_URL,
      issuerUrl: env.BUGDROP_CAPABILITY_ENDPOINT,
      transport: 'public-https',
    });
  });
  it.each(['service', 'self-service', 'invalid-build'])(
    'fails closed rather than monitoring %s as the public SDK path',
    async (mode) => {
      const { env } = fixture();
      env.HEARTBEAT_BUILD = mode === 'invalid-build' ? 'invalid' : sha;
      if (mode === 'service') env.CAPABILITY_SERVICE = { fetch: vi.fn() };
      if (mode === 'self-service') env.SELF_SERVICE_BINDING = '1';
      expect((await worker.fetch(get(), env)).status).toBe(503);
      if (env.CAPABILITY_SERVICE) expect(env.CAPABILITY_SERVICE.fetch).not.toHaveBeenCalled();
    }
  );
});
