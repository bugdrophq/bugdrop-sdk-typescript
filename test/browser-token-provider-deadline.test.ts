import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAnonymousTokenProvider } from '@bugdrop/browser';
import { binding, origin } from './helpers/adapter-fixture.js';
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('location', { origin, protocol: 'https:' });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('bounds abort-ignoring fetch and stalled response at 25 seconds', async () => {
  for (const fetch of [
    vi.fn(() => new Promise(() => {})),
    vi.fn(
      async () =>
        new Response(new ReadableStream({}), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        })
    ),
  ]) {
    vi.stubGlobal('fetch', fetch);
    const pending = expect(createAnonymousTokenProvider()(binding)).rejects.toThrow(
      'Unable to authorize'
    );
    await vi.advanceTimersByTimeAsync(25_000);
    await pending;
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});
it('propagates cancellation and prevents fetch for an already cancelled provider', async () => {
  const fetch = vi.fn(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  const pending = expect(
    createAnonymousTokenProvider({ signal: controller.signal })(binding)
  ).rejects.toThrow('Unable to authorize');
  controller.abort();
  await pending;
  expect(fetch.mock.calls).toHaveLength(1);
  await expect(
    createAnonymousTokenProvider({ signal: controller.signal })(binding)
  ).rejects.toThrow('Unable to authorize');
  expect(fetch.mock.calls).toHaveLength(1);
});
