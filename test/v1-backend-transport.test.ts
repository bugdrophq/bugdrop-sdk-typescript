import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import bindingFixture from '../packages/contracts/fixtures/submission-binding.v1.json';
import credential from '../packages/contracts/fixtures/api-key-credential.v1.json';
import { createV1Handler } from '../examples/v1-backend/handler.js';
import { createV1TokenProvider } from '../examples/v1-backend/transport.js';

const origin = 'https://app.example.com';
const url = `${origin}/api/bugdrop-capability/v1`;
const binding = bindingFixture.bound;
const body = JSON.stringify(binding);
const capability = () => ({
  schemaVersion: 1,
  token: 'local-fixture-capability',
  expiresAt: new Date(Date.now() + 240_000).toISOString(),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-02T12:00:00.000Z');
  vi.stubGlobal('location', { protocol: 'https:', origin });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('V1 browser customer transport', () => {
  it('sends one same-origin request through customer policy into server SDK', async () => {
    const exchange = vi.fn<typeof fetch>(async (_target, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ schemaVersion: 1, ...binding, origin });
      expect(new Headers(init?.headers).get('Authorization')).toBe(credential.authorization);
      return new Response(JSON.stringify(capability()));
    });
    const handler = createV1Handler(
      {
        apiKey: credential.apiKey,
        origin,
        endpoint: 'https://api.example.com/v1/submission-capabilities',
        fetch: exchange,
      },
      (request) => request.headers.get('X-BugDrop-CSRF-Token') === 'csrf-fixture'
    );
    const browserFetch = vi.fn<typeof fetch>(async (target, init) => {
      expect(target).toBe(url);
      expect(init).toEqual({
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json', 'X-BugDrop-CSRF-Token': 'csrf-fixture' },
        redirect: 'error',
        credentials: 'same-origin',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      return handler(
        new Request(String(target), {
          method: 'POST',
          body: String(init?.body),
          headers: { ...(init?.headers as Record<string, string>), Origin: origin },
        })
      );
    });
    vi.stubGlobal('fetch', browserFetch);
    expect(await createV1TokenProvider(() => 'csrf-fixture')(binding)).toEqual(capability());
    expect(browserFetch).toHaveBeenCalledOnce();
    expect(exchange).toHaveBeenCalledOnce();
  });

  it.each([
    () => new Response('private-canary', { status: 503 }),
    () =>
      new Response('private-canary', {
        status: 307,
        headers: { Location: 'https://attacker.example' },
      }),
    () =>
      new Response('{}', {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
    () =>
      new Response(' '.repeat(32769), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
  ])('redacts errors and never retries %#', async (respond) => {
    const browserFetch = vi.fn<typeof fetch>(async () => respond());
    vi.stubGlobal('fetch', browserFetch);
    await expect(createV1TokenProvider(() => 'csrf-fixture')(binding)).rejects.toThrow(
      /^Unable to authorize BugDrop$/
    );
    expect(browserFetch).toHaveBeenCalledOnce();
  });

  it('fails before fetch for missing CSRF source, invalid token, HTTP and oversized binding', async () => {
    const browserFetch = vi.fn();
    vi.stubGlobal('fetch', browserFetch);
    expect(() => createV1TokenProvider(undefined as never)).toThrow('CSRF');
    await expect(createV1TokenProvider(() => '')(binding)).rejects.toThrow();
    vi.stubGlobal('location', { protocol: 'http:', origin });
    await expect(createV1TokenProvider(() => 'csrf-fixture')(binding)).rejects.toThrow();
    vi.stubGlobal('location', { protocol: 'https:', origin });
    await expect(
      createV1TokenProvider(() => 'csrf-fixture')({ ...binding, submissionId: 'x'.repeat(1025) })
    ).rejects.toThrow();
    await expect(
      createV1TokenProvider(() => 'csrf-fixture')({ ...binding, userId: 'private-canary' } as never)
    ).rejects.toThrow();
    expect(browserFetch).not.toHaveBeenCalled();
  });

  it('bundles without server authority, credentials or Node modules', async () => {
    const result = await build({
      entryPoints: ['examples/v1-backend/transport.ts'],
      bundle: true,
      platform: 'browser',
      write: false,
      metafile: true,
    });
    expect(Object.keys(result.metafile!.inputs)).toEqual(['examples/v1-backend/transport.ts']);
    expect(result.outputFiles![0]!.text).not.toMatch(
      /bd_api|bd_auth|node:crypto|createV1Handler|Authorization/
    );
  });
});
