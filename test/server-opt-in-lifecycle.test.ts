import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { BugDropOptIn } from '../packages/server/src/opt-in.js';
import {
  binding,
  browserMetadata,
  clock,
  options,
  response,
  responseHeaders,
  responsePayload,
} from '../packages/server/test/opt-in-fixture.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(clock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const call = (fetch: typeof globalThis.fetch) =>
  new BugDropOptIn(options(fetch)).createSubmissionCapability(binding, browserMetadata);

describe('eight-second seal and bounded cleanup', () => {
  it('seals a late response using monotonic time before the timeout callback runs', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(8000);
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => response(init));
    await expect(call(fetch)).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('includes final signature verification in the monotonic success budget', async () => {
    const timer = vi.spyOn(performance, 'now');
    for (let i = 0; i < 6; i++) timer.mockReturnValueOnce(0);
    timer.mockReturnValue(8000);
    await expect(call(async (_url, init) => response(init))).rejects.toMatchObject({
      code: 'exchange_unconfirmed',
    });
    expect(timer).toHaveBeenCalledTimes(7);
  });
  it('rejects at 8s even if fetch ignores abort, then cancels a late valid response without releasing it', async () => {
    let resolve!: (value: Response) => void;
    let init: RequestInit | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>((_url, input) => {
      init = input;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const result = call(fetch);
    const rejected = expect(result).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
    await vi.advanceTimersByTimeAsync(7999);
    expect(init?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(init?.signal?.aborted).toBe(true);
    const cancel = vi.fn();
    resolve(new Response(new ReadableStream({ cancel }), { headers: responseHeaders }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('seals a never-ending response body and does not wait for cancellation', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(new ReadableStream({ cancel }), { headers: responseHeaders })
    );
    const result = call(fetch);
    const rejected = expect(result).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
    await vi.advanceTimersByTimeAsync(8000);
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a rejected fetch after the seal without an unhandled rejection or retry', async () => {
    let reject!: (error: Error) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise((_done, fail) => {
          reject = fail;
        })
    );
    const result = call(fetch);
    const rejected = expect(result).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
    await vi.advanceTimersByTimeAsync(8000);
    await rejected;
    reject(new Error('secret transport error'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('redacts synchronous network throws and rejects backward wall-clock time', async () => {
    const throwing = vi.fn<typeof globalThis.fetch>(() => {
      throw new Error('secret transport error');
    });
    await expect(call(throwing)).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const result = response(init);
      vi.setSystemTime(clock - 1);
      return result;
    });
    await expect(call(fetch)).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
  });
});

describe('bounded strict response decoding', () => {
  it('accepts empty and one-byte fragments within the response budget', async () => {
    await expect(
      call(async (_url, init) => {
        const body = new TextEncoder().encode(JSON.stringify(responsePayload(init)));
        let index = -256;
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (index < 0) {
                index++;
                controller.enqueue(new Uint8Array(0));
              } else if (index < body.length) controller.enqueue(body.slice(index, ++index));
              else controller.close();
            },
          }),
          { headers: responseHeaders }
        );
      })
    ).resolves.toBeDefined();
  });
  it.each([
    (s: string) => s.replace('"schemaVersion":2', '"schemaVersion":2,"schemaVersion":2'),
    (s: string) => s.replace('"schemaVersion":2', '"schemaVersion":2e0'),
    (s: string) => s.replace('"schemaVersion":2', '"schemaVersion":2.0'),
    (s: string) => s.replace('"schemaVersion":2', '"schemaVersion":-0'),
    (s: string) => '\ufeff' + s,
    (s: string) => s + 'false',
    () => '{"a":{"b":{"c":{"d":{}}}}}',
    () => '{"a":true,"b":false,"c":null,"d":[1,2]}',
    () => '{"a":"\\ud800"}',
    () => '{"a":"unterminated}',
    () => '{"a":9007199254740992}',
    () => '{"a":1,}',
  ])('rejects malformed/duplicate/ambiguous raw JSON %#', async (change) => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_url, init) =>
        new Response(change(JSON.stringify(responsePayload(init))), { headers: responseHeaders })
    );
    await expect(call(fetch)).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
  });

  it('accepts insignificant whitespace and escaped semantic object keys', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const body = JSON.stringify(responsePayload(init), null, 2).replace(
        '"schemaVersion"',
        '"schema\\u0056ersion"'
      );
      return new Response(` \r\n${body}\t`, { headers: responseHeaders });
    });
    await expect(call(fetch)).resolves.toBeDefined();
  });

  it.each([65_537, 100_000])(
    'rejects actual stream size %s without trusting Content-Length',
    async (size) => {
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () => new Response(new Uint8Array(size), { headers: responseHeaders })
      );
      await expect(call(fetch)).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
    }
  );

  it('rejects malformed UTF-8, stream errors, absent body and a locked body', async () => {
    const bad = [
      new Response(new Uint8Array([0xff]), { headers: responseHeaders }),
      new Response(
        new ReadableStream({
          start(c) {
            c.error(new Error('secret'));
          },
        }),
        { headers: responseHeaders }
      ),
      new Response(null, { headers: responseHeaders }),
    ];
    const locked = new Response('{}', { headers: responseHeaders });
    locked.body!.getReader();
    bad.push(locked);
    for (const response of bad)
      await expect(call(async () => response)).rejects.toMatchObject({
        code: 'exchange_unconfirmed',
      });
  });

  it.each([
    { 'Content-Type': 'application/json' },
    { 'Cache-Control': 'no-store, no-store' },
    { 'Content-Type': `${responseHeaders['Content-Type']}, ${responseHeaders['Content-Type']}` },
    { 'Content-Encoding': 'gzip' },
    { 'Set-Cookie': 'private=secret' },
    { Location: 'https://other.example' },
    { 'Content-Length': '65537' },
    { 'Content-Length': '12,12' },
  ])('rejects incompatible response headers %#', async (extra) => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_url, init) =>
        new Response(JSON.stringify(responsePayload(init)), {
          headers: { ...responseHeaders, ...extra } as HeadersInit,
        })
    );
    await expect(call(fetch)).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
  });

  it('rejects excessive visible header count/bytes and redirected responses', async () => {
    for (const extra of [
      Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`x-${i}`, 'x'])),
      { server: 'x'.repeat(32768) },
    ]) {
      await expect(
        call(
          async (_url, init) =>
            new Response(JSON.stringify(responsePayload(init)), {
              headers: { ...responseHeaders, ...extra },
            })
        )
      ).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
    }
    await expect(
      call(async (_url, init) => {
        const r = response(init);
        Object.defineProperty(r, 'redirected', { value: true });
        return r;
      })
    ).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
  });
});
