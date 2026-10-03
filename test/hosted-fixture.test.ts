import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../examples/hosted-fixture/worker.js';
import { FixtureState } from '../examples/hosted-fixture/state.js';
import type {
  FixtureEnv,
  FixtureExecutionContext,
  FixtureStorage,
} from '../examples/hosted-fixture/types.js';

const ORIGIN = 'https://sdk-fixture.example';
const DIGEST = Buffer.alloc(32, 1).toString('base64url');
const OTHER_DIGEST = Buffer.alloc(32, 2).toString('base64url');
const KEY = `bd_api_v1.${Buffer.alloc(16, 1).toString('base64url')}.${Buffer.alloc(32, 2).toString('base64url')}`;

class MemoryStorage implements FixtureStorage {
  readonly values = new Map<string, unknown>();
  private tail = Promise.resolve();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
  async transaction<T>(callback: (tx: FixtureStorage) => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await callback(this);
    } finally {
      release();
    }
  }
}

function fixture() {
  const storage = new MemoryStorage();
  const state = new FixtureState({ storage });
  const stub = { fetch: (request: Request) => state.fetch(request) };
  const env: FixtureEnv = {
    FIXTURE_ENABLED: 'true',
    FIXTURE_ORIGIN: ORIGIN,
    APPLICATION_ID: 'app_fixture',
    WIDGET_URL: 'https://widget.bugdrop.dev/widget.v1.js',
    OPERATOR_PASSWORD: 'test-password-that-is-over-32-bytes-long',
    BUGDROP_API_KEY: KEY,
    BUGDROP_CAPABILITY_ENDPOINT: 'https://issuer.example/v1/submission-capabilities',
    FIXTURE_STATE: { idFromName: (name) => name, get: () => stub },
    ASSETS: { fetch: async () => new Response('/* fixture */') },
  };
  return { storage, state, env };
}

async function stateCall(state: FixtureState, path: string, body: object) {
  return state.fetch(
    new Request(`https://fixture-state.internal${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

async function login(env: FixtureEnv): Promise<{ cookie: string; csrf: string }> {
  const response = await worker.fetch(
    new Request(`${ORIGIN}/login`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `password=${encodeURIComponent(env.OPERATOR_PASSWORD)}`,
    }),
    env
  );
  expect(response.status).toBe(303);
  const cookie = response.headers.get('Set-Cookie')!.split(';')[0]!;
  const page = await worker.fetch(new Request(ORIGIN, { headers: { Cookie: cookie } }), env);
  const html = await page.text();
  const csrf = html.match(/data-csrf="([a-f0-9]{64})"/)?.[1];
  expect(csrf).toBeDefined();
  return { cookie, csrf: csrf! };
}

function capability(
  env: FixtureEnv,
  options: {
    cookie?: string;
    csrf?: string;
    origin?: string;
    id?: string;
    digest?: string;
  } = {},
  context?: FixtureExecutionContext
) {
  return worker.fetch(
    new Request(`${ORIGIN}/api/bugdrop-capability/v1`, {
      method: 'POST',
      headers: {
        Origin: options.origin ?? ORIGIN,
        'Content-Type': 'application/json',
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(options.csrf ? { 'X-BugDrop-CSRF-Token': options.csrf } : {}),
      },
      body: JSON.stringify({
        submissionId: options.id ?? 'submission-1',
        payloadDigest: options.digest ?? DIGEST,
      }),
    }),
    env,
    context
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('hosted fixture', () => {
  it('stays unavailable when the rollout gate is off, even with otherwise valid bindings', async () => {
    const { env } = fixture();
    env.FIXTURE_ENABLED = 'false';
    const issuer = vi.fn();
    vi.stubGlobal('fetch', issuer);
    expect((await worker.fetch(new Request(ORIGIN), env)).status).toBe(503);
    expect((await capability(env)).status).toBe(503);
    expect(issuer).not.toHaveBeenCalled();
  });

  it('fails closed with absent issuer configuration and never authenticates', async () => {
    const { env } = fixture();
    env.BUGDROP_CAPABILITY_ENDPOINT = '';
    expect((await worker.fetch(new Request(ORIGIN), env)).status).toBe(503);
    expect((await capability(env)).status).toBe(503);
  });

  it('requires operator login, session, CSRF, and exact HTTPS origin before issuer exchange', async () => {
    const { env } = fixture();
    const issuer = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', issuer);
    expect((await capability(env)).status).toBe(502);
    const active = await login(env);
    expect((await capability(env, { cookie: active.cookie })).status).toBe(502);
    expect(
      (
        await capability(env, {
          cookie: active.cookie,
          csrf: active.csrf,
          origin: 'https://attacker.example',
        })
      ).status
    ).toBe(502);
    expect((await worker.fetch(new Request('https://other.example/'), env)).status).toBe(502);
    expect(issuer).not.toHaveBeenCalled();
    expect((await capability(env, { cookie: active.cookie, csrf: active.csrf })).status).toBe(502);
    expect(issuer).toHaveBeenCalledTimes(1);
  });

  it('rejects changed digest, another session, and concurrent exchange of one session', async () => {
    const { state, env } = fixture();
    const first = await login(env);
    const second = await login(env);
    const firstId = first.cookie.split('=')[1]!;
    const secondId = second.cookie.split('=')[1]!;
    const binding = { submissionId: 'submission-1', payloadDigest: DIGEST };
    const approve = (sessionId: string, csrf: string, digest = DIGEST) =>
      stateCall(state, '/authorize', { sessionId, csrf, ...binding, payloadDigest: digest });
    const [one, concurrent] = await Promise.all([
      approve(firstId, first.csrf),
      approve(firstId, first.csrf),
    ]);
    expect([one.status, concurrent.status].sort()).toEqual([200, 403]);
    expect((await approve(secondId, second.csrf)).status).toBe(403);
    expect((await approve(firstId, first.csrf, OTHER_DIGEST)).status).toBe(403);
    const winner = one.status === 200 ? one : concurrent;
    const { lease } = (await winner.json()) as { lease: string };
    expect((await stateCall(state, '/finish', { sessionId: firstId, lease })).status).toBe(200);
    expect((await approve(firstId, first.csrf)).status).toBe(200);
  });

  it('returns redacted denial with no local capability when upstream is absent', async () => {
    const { env } = fixture();
    const active = await login(env);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('issuer offline');
      })
    );
    const response = await capability(env, active);
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('{"error":"unable_to_authorize_bugdrop"}');
  });
});

describe('hosted fixture lease cleanup', () => {
  it('returns an issued capability while lease cleanup is still pending', async () => {
    const { env, storage } = fixture();
    const active = await login(env);
    const originalStub = env.FIXTURE_STATE.get('global-v1');
    let releaseFinish!: () => void;
    let notifyFinish!: () => void;
    const finishBlocked = new Promise<void>((resolve) => {
      releaseFinish = resolve;
    });
    const finishStarted = new Promise<void>((resolve) => {
      notifyFinish = resolve;
    });
    env.FIXTURE_STATE = {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (request) => {
          if (new URL(request.url).pathname === '/finish') {
            notifyFinish();
            await finishBlocked;
          }
          return originalStub.fetch(request);
        },
      }),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          schemaVersion: 1,
          token: 'opaque-capability',
          expiresAt: new Date(Date.now() + 240_000).toISOString(),
        })
      )
    );
    const lifetime: Promise<unknown>[] = [];
    let delivered: Response | undefined;
    const response = capability(env, active, { waitUntil: (promise) => lifetime.push(promise) });
    void response.then((value) => {
      delivered = value;
    });
    try {
      await finishStarted;
      await vi.waitFor(() => expect(delivered?.status).toBe(200));
      expect(lifetime).toHaveLength(1);
    } finally {
      releaseFinish();
      await response;
      await Promise.all(lifetime);
    }
    const id = active.cookie.split('=')[1]!;
    expect(storage.values.get(`session:${id}`)).not.toHaveProperty('active');
  });
});

describe('hosted fixture rate limits', () => {
  it('rate limits operator attempts and authorized capability exchanges', async () => {
    const { env } = fixture();
    const badLogin = () =>
      worker.fetch(
        new Request(`${ORIGIN}/login`, {
          method: 'POST',
          headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'password=wrong',
        }),
        env
      );
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await badLogin()).status).toBe(502);
    }
    expect((await badLogin()).status).toBe(502);
    const blockedGoodLogin = await worker.fetch(
      new Request(`${ORIGIN}/login`, {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `password=${encodeURIComponent(env.OPERATOR_PASSWORD)}`,
      }),
      env
    );
    expect(blockedGoodLogin.status).toBe(502);

    const fresh = fixture();
    const active = await login(fresh.env);
    const sessionId = active.cookie.split('=')[1]!;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const result = await stateCall(fresh.state, '/authorize', {
        sessionId,
        csrf: active.csrf,
        submissionId: `rate-${attempt}`,
        payloadDigest: DIGEST,
      });
      expect(result.status).toBe(200);
      const { lease } = (await result.json()) as { lease: string };
      await stateCall(fresh.state, '/finish', { sessionId, lease });
    }
    expect(
      (
        await stateCall(fresh.state, '/authorize', {
          sessionId,
          csrf: active.csrf,
          submissionId: 'rate-over',
          payloadDigest: DIGEST,
        })
      ).status
    ).toBe(403);
    expect(fresh.storage.values.size).toBeGreaterThan(1);
  });
});
