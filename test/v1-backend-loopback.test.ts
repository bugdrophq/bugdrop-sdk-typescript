import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import bindingFixture from '../packages/contracts/fixtures/submission-binding.v1.json';
import { createV1TokenProvider } from '../examples/v1-backend/transport.js';
import { startLoopback } from '../examples/v1-backend/loopback-server.js';

type Fixture = Awaited<ReturnType<typeof startLoopback>>;
const binding = bindingFixture.bound;
const changed = { ...binding, payloadDigest: 'A'.repeat(43) };
const fixtures: Fixture[] = [];
const directories: string[] = [];
const nativeFetch = globalThis.fetch;

async function start(directory?: string) {
  const path = directory ?? (await mkdtemp(join(tmpdir(), 'bugdrop-v1-loopback-')));
  if (!directory) directories.push(path);
  const fixture = await startLoopback(path, '/* local browser bundle */');
  fixtures.push(fixture);
  return { fixture, path };
}

async function session(fixture: Fixture) {
  const response = await nativeFetch(fixture.origin);
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  const csrf = (await response.text()).match(/data-csrf="([a-f0-9]{64})"/)?.[1];
  expect(cookie).toMatch(/^bd_loopback_session=[a-f0-9]{64}$/);
  expect(csrf).toMatch(/^[a-f0-9]{64}$/);
  return { cookie: cookie!, csrf: csrf! };
}

async function post(
  fixture: Fixture,
  identity: Awaited<ReturnType<typeof session>>,
  value = binding
) {
  return nativeFetch(`${fixture.origin}/api/bugdrop-capability/v1`, {
    method: 'POST',
    headers: {
      Origin: fixture.origin,
      Cookie: identity.cookie,
      'Content-Type': 'application/json',
      'X-BugDrop-CSRF-Token': identity.csrf,
    },
    body: JSON.stringify(value),
  });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('runnable V1 customer loopback fixture', () => {
  it('exercises packed-style browser transport, customer policy and server SDK without an external issuer', async () => {
    const { fixture } = await start();
    const identity = await session(fixture);
    vi.stubGlobal('location', { origin: fixture.origin, protocol: 'http:' });
    const browserFetch = vi.fn<typeof fetch>((target, init) =>
      nativeFetch(target, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string>),
          Origin: fixture.origin,
          Cookie: identity.cookie,
        },
      })
    );
    vi.stubGlobal('fetch', browserFetch);
    const capability = await createV1TokenProvider(() => identity.csrf)(binding);
    expect(capability.schemaVersion).toBe(1);
    expect(capability.token).toMatch(/^local-fixture-/);
    expect(browserFetch).toHaveBeenCalledOnce();
    expect(fixture.exchanges()).toBe(1);
    expect(JSON.stringify(browserFetch.mock.calls)).not.toContain('bd_api_v1');
  });

  it('rejects missing CSRF, cross-session replay and digest conflict before issuer exchange', async () => {
    const { fixture } = await start();
    const first = await session(fixture);
    const second = await session(fixture);
    const invalid = await post(fixture, { ...first, csrf: '0'.repeat(64) });
    expect(invalid.status).toBe(502);
    expect(fixture.exchanges()).toBe(0);
    expect((await post(fixture, first)).status).toBe(200);
    expect((await post(fixture, second)).status).toBe(502);
    expect((await post(fixture, first, changed)).status).toBe(502);
    expect(
      (await post(fixture, { ...first, cookie: `${first.cookie}; bd_loopback_session=bad` })).status
    ).toBe(502);
    expect(fixture.exchanges()).toBe(1);
  });

  it('allows explicit lost-reply retry with the same binding after restart', async () => {
    const { fixture, path } = await start();
    const identity = await session(fixture);
    const lostReply = await post(fixture, identity);
    expect(lostReply.status).toBe(200);
    // Simulate a response lost after the issuer exchange. The client explicitly retries.
    await lostReply.body?.cancel();
    await fixture.close();
    fixtures.splice(fixtures.indexOf(fixture), 1);
    const { fixture: restarted } = await start(path);
    expect((await post(restarted, identity)).status).toBe(200);
    expect((await post(restarted, identity, changed)).status).toBe(502);
    expect(restarted.exchanges()).toBe(1);
  });

  it('serializes competing bindings for one submission ID', async () => {
    const { fixture } = await start();
    const identity = await session(fixture);
    const responses = await Promise.all([
      post(fixture, identity),
      post(fixture, identity, changed),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 502]);
    expect(fixture.exchanges()).toBe(1);
  });
});
