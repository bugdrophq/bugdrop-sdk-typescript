import * as authentication from '../packages/server/src/api-key.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCapabilityHandler } from '@bugdrop/server/adapter';
import { body, denied, options, request, upstream, capability } from './helpers/adapter-fixture.js';
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const never = () => new Promise<never>(() => {});
describe('18 second end to end bound', () => {
  it('allows a realistic 12 second issuer RPC', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      await new Promise((r) => setTimeout(r, 12_000));
      return Response.json({ ...capability(), admission: 'managed-v1' });
    });
    const pending = createCapabilityHandler(options(fetch))(request());
    await vi.advanceTimersByTimeAsync(12_000);
    expect((await pending).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds a stalled raw body and cancels its reader', async () => {
    const cancel = vi.fn();
    const fetch = upstream();
    const pending = createCapabilityHandler(options(fetch))(
      request(new ReadableStream({ cancel }), { ...({ duplex: 'half' } as object) })
    );
    await vi.advanceTimersByTimeAsync(18_000);
    await denied(await pending);
    expect(cancel).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('settles a stalled policy and prevents a late issuer call', async () => {
    let resolve!: (value: boolean) => void;
    const policy = () =>
      new Promise<boolean>((r) => {
        resolve = r;
      });
    const fetch = upstream();
    const pending = createCapabilityHandler({ ...options(fetch), mode: 'customer-policy', policy })(
      request()
    );
    await vi.advanceTimersByTimeAsync(18_000);
    await denied(await pending);
    resolve(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('bounds abort-ignoring transport and response reading', async () => {
    for (const fetch of [
      vi.fn<typeof globalThis.fetch>(never),
      vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({}))),
    ]) {
      const pending = createCapabilityHandler(options(fetch))(request());
      await vi.advanceTimersByTimeAsync(18_000);
      await denied(await pending);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it('cancels policy on disconnect without late work', async () => {
    let resolve!: (value: boolean) => void;
    const fetch = upstream();
    const controller = new AbortController();
    const pending = createCapabilityHandler({
      ...options(fetch),
      mode: 'customer-policy',
      policy: () =>
        new Promise<boolean>((r) => {
          resolve = r;
        }),
    })(request(body, { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await denied(await pending);
    resolve(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});

it('blocks late issuer contact when SDK authentication finishes after cancellation', async () => {
  let resolve!: (value: Readonly<Record<string, string>>) => void;
  vi.spyOn(authentication, 'createApiKeyAuthenticator').mockReturnValue({
    authenticateRequest: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const fetch = upstream();
  const pending = createCapabilityHandler(options(fetch))(request());
  await vi.advanceTimersByTimeAsync(18_000);
  await denied(await pending);
  resolve({ Authorization: 'synthetic' });
  await vi.advanceTimersByTimeAsync(1);
  expect(fetch).not.toHaveBeenCalled();
});
