import { expect } from 'vitest';
import worker from '../examples/hosted-fixture/worker.js';
import { FixtureState } from '../examples/hosted-fixture/state.js';
import type {
  FixtureEnv,
  FixtureExecutionContext,
  FixtureStorage,
} from '../examples/hosted-fixture/types.js';
export const ORIGIN = 'https://sdk-fixture.example';
export const DIGEST = Buffer.alloc(32, 1).toString('base64url');
export const OTHER_DIGEST = Buffer.alloc(32, 2).toString('base64url');
export const KEY = `bd_api_v1.${Buffer.alloc(16, 1).toString('base64url')}.${Buffer.alloc(32, 2).toString('base64url')}`;

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

export function fixture() {
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

export async function stateCall(state: FixtureState, path: string, body: object) {
  return state.fetch(
    new Request(`https://fixture-state.internal${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

export async function login(env: FixtureEnv): Promise<{ cookie: string; csrf: string }> {
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

export function capability(
  env: FixtureEnv,
  options: {
    cookie?: string;
    csrf?: string;
    origin?: string;
    site?: string;
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
        'Sec-Fetch-Site': options.site ?? 'same-origin',
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
