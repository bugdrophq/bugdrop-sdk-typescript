import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCapabilityHandler } from '@bugdrop/server/adapter';
import { denied, options, request } from './helpers/adapter-fixture.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it.each(['deadline', 'cancelled'] as const)(
  'cancels the owned issuer reader on %s',
  async (reason) => {
    let sourceController!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        sourceController = controller;
      },
      cancel,
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(source));
    const controller = new AbortController();
    const observeFailure = vi.fn();
    const pending = createCapabilityHandler({ ...options(fetch), observeFailure })(
      request(undefined, { signal: controller.signal })
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(source.locked).toBe(true);
    if (reason === 'cancelled') controller.abort();
    else await vi.advanceTimersByTimeAsync(17_999);
    await denied(await pending);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(source.locked).toBe(false);
    expect(() => sourceController.enqueue(new Uint8Array(65_536))).toThrow();
    expect(observeFailure).toHaveBeenCalledTimes(1);
    expect(observeFailure.mock.calls[0]![0].phase).toBe(reason);
  }
);

it('closes an unread issuer error response without retry', async () => {
  const cancel = vi.fn();
  const source = new ReadableStream<Uint8Array>({ cancel });
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(source, { status: 503 }));
  await denied(await createCapabilityHandler(options(fetch))(request()));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(source.locked).toBe(false);
});
