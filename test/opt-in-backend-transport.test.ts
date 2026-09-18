import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { createOptInHandler } from '../examples/opt-in-backend/handler.js';
import { tokenProviderWithMetadata } from '../examples/opt-in-backend/transport.js';
import {
  binding,
  browserMetadata,
  clock,
  fixture,
  options,
  response,
} from '../packages/server/test/opt-in-fixture.js';

const origin = fixture.request.intent.origin;
const url = `${origin}/api/bugdrop-capability/v2`;
const body = JSON.stringify({ binding, metadata: browserMetadata });
function request(content: BodyInit = body, init: RequestInit = {}, target = url) {
  return new Request(target, {
    method: 'POST',
    body: content,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    ...init,
  });
}
function issuer() {
  return vi.fn<typeof fetch>(async (_url, init) => response(init));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(clock);
  vi.stubGlobal('location', { protocol: 'https:', origin });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('reference browser transport', () => {
  it('uses fixed same-origin options end to end through the actual signed P1 exchange', async () => {
    const handler = createOptInHandler(options(issuer()), () => true);
    const browserFetch = vi.fn<typeof fetch>(async (target, init) => {
      expect(target).toBe(url);
      expect(init).toEqual({
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        redirect: 'error',
        credentials: 'same-origin',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      return handler(request(String(init?.body)));
    });
    vi.stubGlobal('fetch', browserFetch);
    expect(await tokenProviderWithMetadata(binding, browserMetadata)).toEqual(
      fixture.response.capability
    );
    expect(browserFetch).toHaveBeenCalledOnce();
  });

  it.each([
    () => new Response('private-canary', { status: 502 }),
    () =>
      new Response('private-canary', {
        status: 302,
        headers: { Location: 'https://attacker.test' },
      }),
    () =>
      new Response('{}', {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
    () =>
      new Response(' '.repeat(32769), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
    () => {
      throw new Error('private-canary');
    },
  ])('returns fixed transport errors without retry or reflection %#', async (make) => {
    const browserFetch = vi.fn(async () => make());
    vi.stubGlobal('fetch', browserFetch);
    await expect(tokenProviderWithMetadata(binding, browserMetadata)).rejects.toThrow(
      /^Unable to authorize BugDrop$/
    );
    expect(browserFetch).toHaveBeenCalledOnce();
  });

  it('cancels rejected responses without waiting for cancellation', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 502 }))
    );
    await expect(tokenProviderWithMetadata(binding, browserMetadata)).rejects.toThrow(
      'Unable to authorize BugDrop'
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    'null',
    '[]',
    '{',
    '{"schemaVersion":1,"token":"x","expiresAt":"bad"}',
    JSON.stringify({ ...fixture.response.capability, privateField: 'private-canary' }),
  ])('rejects malformed capability envelopes %#', async (content) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(content, {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          })
      )
    );
    await expect(tokenProviderWithMetadata(binding, browserMetadata)).rejects.toThrow(
      /^Unable to authorize BugDrop$/
    );
  });

  it('rejects HTTP and oversized requests locally', async () => {
    const browserFetch = vi.fn();
    vi.stubGlobal('fetch', browserFetch);
    vi.stubGlobal('location', { protocol: 'http:', origin });
    await expect(tokenProviderWithMetadata(binding, browserMetadata)).rejects.toThrow();
    vi.stubGlobal('location', { protocol: 'https:', origin });
    await expect(
      tokenProviderWithMetadata({ ...binding, submissionId: 'x'.repeat(2049) }, browserMetadata)
    ).rejects.toThrow();
    expect(browserFetch).not.toHaveBeenCalled();
  });

  it('bundles the browser transport without server code, credentials or Node dependencies', async () => {
    const result = await build({
      entryPoints: ['examples/opt-in-backend/transport.ts'],
      bundle: true,
      platform: 'browser',
      write: false,
      metafile: true,
    });
    expect(Object.keys(result.metafile!.inputs)).toEqual(['examples/opt-in-backend/transport.ts']);
    expect(result.outputFiles![0]!.text).not.toMatch(
      /bd_api|bd_auth|node:crypto|createOptInHandler/
    );
  });
});
