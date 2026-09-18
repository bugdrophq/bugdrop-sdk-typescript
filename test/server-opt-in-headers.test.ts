import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BugDropOptIn } from '../packages/server/src/opt-in.js';
import { responseLength } from '../packages/server/src/opt-in-headers.js';
import {
  binding,
  browserMetadata,
  clock,
  options,
  resign,
  responseHeaders,
  responsePayload,
} from '../packages/server/test/opt-in-fixture.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(clock);
});
afterEach(() => vi.useRealTimers());
const call = (fetch: typeof globalThis.fetch) =>
  new BugDropOptIn(options(fetch)).createSubmissionCapability(binding, browserMetadata);

describe('approved transport-only response header boundary', () => {
  it('accepts strict Date/Server and actual byte length without using Date as authority', async () => {
    await expect(
      call(async (_url, init) => {
        const payload = responsePayload(init);
        payload.capability.token = 'UTF8-test-é';
        resign(payload);
        const body = JSON.stringify(payload);
        expect(Buffer.byteLength(body)).toBeGreaterThan(body.length);
        return new Response(body, {
          headers: {
            ...responseHeaders,
            'Content-Length': String(Buffer.byteLength(body)),
            Date: 'Sun, 06 Nov 1994 08:49:37 GMT',
            Server: 'fixture/1.0',
          },
        });
      })
    ).resolves.toMatchObject({ token: 'UTF8-test-é' });
  });

  it.each([-1, 1])('rejects Content-Length mismatch %s against bytes consumed', async (delta) => {
    await expect(
      call(async (_url, init) => {
        const body = JSON.stringify(responsePayload(init));
        return new Response(body, {
          headers: {
            ...responseHeaders,
            'Content-Length': String(Buffer.byteLength(body) + delta),
          },
        });
      })
    ).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
  });

  it.each([
    ['Content-Length', '01'],
    ['Content-Length', '+1'],
    ['Content-Length', '1e3'],
    ['Content-Length', '1.0'],
    ['Date', 'Mon, 06 Nov 1994 08:49:37 GMT'],
    ['Date', 'Sun, 31 Feb 1994 08:49:37 GMT'],
    ['Date', 'Sunday, 06-Nov-94 08:49:37 GMT'],
    ['Date', 'Sun, 06 Nov 1994 25:49:37 GMT'],
    ['Date', 'Sun, 06 Nov 1994 08:49:37 GMT, Sun, 06 Nov 1994 08:49:37 GMT'],
    ['Server', 'first, second'],
    ['Server', ''],
    ['Server', 'é'],
    ['Server', 'fixture\tserver'],
    ['X-Request-Id', 'ignored-is-not-allowed'],
    ['Via', 'proxy'],
    ['ETag', 'tag'],
  ])('rejects visible %s=%s', async (name, value) => {
    await expect(
      call(
        async (_url, init) =>
          new Response(JSON.stringify(responsePayload(init)), {
            headers: { ...responseHeaders, [name]: value },
          })
      )
    ).rejects.toMatchObject({ code: 'exchange_unconfirmed' });
  });

  it('rejects visible duplicate entries and whitespace without normalizing them', () => {
    const values = new Headers(responseHeaders);
    const headers = {
      forEach(callback: (value: string, name: string) => void) {
        values.forEach(callback);
        callback(responseHeaders['Content-Type'], 'Content-Type');
      },
      get: (name: string) => values.get(name),
    };
    expect(() => responseLength({ status: 200, redirected: false, headers } as Response)).toThrow();
    for (const [name, value] of [
      ['date', ' Sun, 06 Nov 1994 08:49:37 GMT'],
      ['content-length', ' 12 '],
    ]) {
      const raw = {
        forEach: values.forEach.bind(values),
        get: (key: string) => (key === name ? value : values.get(key)),
      };
      expect(() =>
        responseLength({ status: 200, redirected: false, headers: raw } as Response)
      ).toThrow();
    }
  });
});
