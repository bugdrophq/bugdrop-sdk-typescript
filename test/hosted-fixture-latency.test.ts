import { afterEach, expect, it, vi } from 'vitest';
import { capability, fixture, login, stateCall, DIGEST } from './hosted-fixture-helpers.js';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
}, 12000);
it('returns a capability after nine seconds without another issuer request', async () => {
  const { env } = fixture();
  const active = await login(env);
  const issuer = vi.fn(
    () =>
      new Promise<Response>((resolve) =>
        setTimeout(
          () =>
            resolve(
              Response.json({
                schemaVersion: 1,
                admission: 'managed-v1',
                token: 'opaque-capability',
                expiresAt: new Date(Date.now() + 240000).toISOString(),
              })
            ),
          9000
        )
      )
  );
  env.CAPABILITY_SERVICE = { fetch: issuer };
  const pending = capability(env, active);
  expect((await pending).status).toBe(200);
  expect(issuer).toHaveBeenCalledOnce();
}, 12000);

it('holds the session lease through a slow exchange and releases it after its bounded lifetime', async () => {
  const { env, state } = fixture();
  const active = await login(env);
  const sessionId = active.cookie.split('=')[1]!;
  const approve = () =>
    stateCall(state, '/authorize', {
      sessionId,
      csrf: active.csrf,
      submissionId: 'slow-exchange',
      payloadDigest: DIGEST,
    });
  vi.useFakeTimers();
  expect((await approve()).status).toBe(200);
  await vi.advanceTimersByTimeAsync(10000);
  expect((await approve()).status).toBe(403);
  await vi.advanceTimersByTimeAsync(11001);
  expect((await approve()).status).toBe(200);
});
