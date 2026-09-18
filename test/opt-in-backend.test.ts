import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOptInHandler } from '../examples/opt-in-backend/handler.js';
import {
  binding,
  browserMetadata,
  clock,
  fixture,
  options,
  response,
  responsePayload,
  responseHeaders,
} from '../packages/server/test/opt-in-fixture.js';
import { validateRequest } from './helpers/opt-in-contract';

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
async function denied(result: Response) {
  expect(result.status).toBe(502);
  const entries: string[][] = [];
  result.headers.forEach((value, key) => entries.push([key, value]));
  expect(entries).toEqual([
    ['cache-control', 'no-store'],
    ['content-type', 'application/json'],
  ]);
  expect(await result.text()).toBe('{"error":"unable_to_authorize_bugdrop"}');
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

describe('reference backend trust boundary', () => {
  it('requires a policy at startup and validates fixed server configuration', () => {
    for (const policy of [undefined, null, true, {}]) {
      expect(() => createOptInHandler(options(issuer()), policy as never)).toThrow('policy');
    }
    expect(() =>
      createOptInHandler({ ...options(issuer()), origin: 'http://insecure.test' }, () => true)
    ).toThrow();
  });

  it('returns only P1-verified capability and never forwards browser headers or authority', async () => {
    const upstream = vi.fn<typeof fetch>(async (target, init) => {
      expect(target).toBe(fixture.request.intent.endpoint);
      const sent = JSON.parse(String(init?.body));
      expect(
        validateRequest(sent, clock, new Headers(init?.headers).get('X-BugDrop-Intent-Signature')!)
      ).toEqual(sent.intent);
      expect(sent.intent).toMatchObject({
        applicationId: fixture.request.intent.applicationId,
        origin,
        ...binding,
      });
      expect(JSON.stringify(init)).not.toContain('private-canary');
      const names: string[] = [];
      new Headers(init?.headers).forEach((_value, key) => names.push(key));
      expect(names.sort()).toEqual([
        'accept',
        'authorization',
        'content-type',
        'x-bugdrop-contract-version',
        'x-bugdrop-intent-signature',
        'x-bugdrop-sdk-version',
      ]);
      return response(init);
    });
    const policy = vi.fn((r: Request) => r.headers.get('Cookie') === 'private-canary');
    const config = options(upstream);
    const handler = createOptInHandler(config, policy);
    config.applicationId = 'app_changed';
    config.origin = 'https://changed.test';
    const result = await handler(
      request(body, {
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          Cookie: 'private-canary',
          'User-Agent': 'private-canary',
          Referer: 'private-canary',
          'X-Forwarded-For': 'private-canary',
          Authorization: 'private-canary',
          'X-User-Id': 'private-canary',
        },
      })
    );
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(await result.json()).toEqual(fixture.response.capability);
    expect(upstream).toHaveBeenCalledOnce();
    expect(policy).toHaveBeenCalledOnce();
  });

  it.each([false, undefined, 'true', 1, new Error('private-canary')])(
    'fails closed for policy outcome %#',
    async (outcome) => {
      const upstream = issuer();
      const handler = createOptInHandler(options(upstream), async () => {
        if (outcome instanceof Error) throw outcome;
        return outcome as boolean;
      });
      await denied(await handler(request()));
      expect(upstream).not.toHaveBeenCalled();
    }
  );

  it.each([
    [url + '?', {}],
    [url + '#', {}],
    [url + '?x=1', {}],
    [url + '#x', {}],
    [url + '/', {}],
    [url.replace('https:', 'http:'), {}],
    [url.replace(origin, 'https://attacker.test'), {}],
    [url, { method: 'PUT' }],
    [url, { headers: { 'Content-Type': 'application/json' } }],
    [url, { headers: { Origin: 'null', 'Content-Type': 'application/json' } }],
    [url, { headers: { Origin: origin + '/', 'Content-Type': 'application/json' } }],
    [url, { headers: { Origin: origin, 'Content-Type': 'text/plain' } }],
    [
      url,
      {
        headers: { Origin: origin, 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
      },
    ],
  ] as const)(
    'rejects route/media/origin mismatch %# before policy and dispatch',
    async (target, init) => {
      const upstream = issuer();
      const policy = vi.fn(() => true);
      await denied(
        await createOptInHandler(options(upstream), policy)(request(body, init, target))
      );
      expect(upstream).not.toHaveBeenCalled();
      expect(policy).not.toHaveBeenCalled();
    }
  );
});

describe('reference backend body and response boundaries', () => {
  it.each([
    '{}',
    'null',
    '[]',
    '{',
    '\ufeff' + body,
    JSON.stringify({ binding, metadata: browserMetadata, applicationId: 'app_attacker' }),
    JSON.stringify({
      binding: { ...binding, origin: 'https://attacker.test' },
      metadata: browserMetadata,
    }),
    JSON.stringify({ binding, metadata: { ...browserMetadata, credentialId: 'private-canary' } }),
    JSON.stringify({
      binding: { ...binding, submissionId: [binding.submissionId] },
      metadata: browserMetadata,
    }),
    JSON.stringify({ binding: { ...binding, submissionId: '\ud800' }, metadata: browserMetadata }),
    JSON.stringify({ binding: { ...binding, payloadDigest: 'x' }, metadata: browserMetadata }),
    JSON.stringify({ binding, metadata: { ...browserMetadata, metadataVersion: 2 } }),
    JSON.stringify({ binding, metadata: { ...browserMetadata, browserSdkVersion: '01.0.0' } }),
    body.replace('"binding":', '"binding":{},"binding":'),
    body.replace('"metadataVersion":1', '"metadataVersion":2,"metadata\\u0056ersion":1'),
    ' '.repeat(2049),
  ])('rejects malformed or authority-bearing bodies before issuer dispatch %#', async (content) => {
    const upstream = issuer();
    await denied(await createOptInHandler(options(upstream), () => true)(request(content)));
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(['2049', '01', '-1', '0', '1, 2'])(
    'enforces canonical and actual content length %s',
    async (length) => {
      const upstream = issuer();
      await denied(
        await createOptInHandler(
          options(upstream),
          () => true
        )(
          request(body, {
            headers: {
              Origin: origin,
              'Content-Type': 'application/json',
              'Content-Length': length,
            },
          })
        )
      );
      expect(upstream).not.toHaveBeenCalled();
    }
  );

  it('accepts exactly 2048 bytes and rejects malformed UTF-8', async () => {
    const upstream = issuer();
    const handler = createOptInHandler(options(upstream), () => true);
    expect(
      (
        await handler(
          request(body.padEnd(2048), {
            headers: {
              Origin: origin,
              'Content-Type': 'application/json',
              'Content-Length': '2048',
            },
          })
        )
      ).status
    ).toBe(200);
    await denied(await handler(request(new Uint8Array([0xff]))));
    expect(upstream).toHaveBeenCalledOnce();
  });

  it('bounds actual streamed bytes even when cancellation never resolves', async () => {
    const upstream = issuer();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(1024));
        c.enqueue(new Uint8Array(1025));
      },
      cancel,
    });
    await denied(
      await createOptInHandler(
        options(upstream),
        () => true
      )(request(stream, { duplex: 'half' } as RequestInit))
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(upstream).not.toHaveBeenCalled();
  });

  it('cancels policy-denied bodies without waiting for cancellation', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const upstream = issuer();
    const stream = new ReadableStream({ cancel });
    const input = request(stream, { duplex: 'half' } as RequestInit);
    await denied(await createOptInHandler(options(upstream), () => false)(input));
    expect(cancel).toHaveBeenCalledOnce();
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects aborted requests and cannot release a modified signed capability', async () => {
    const abort = new AbortController();
    abort.abort();
    const upstream = issuer();
    await denied(
      await createOptInHandler(
        options(upstream),
        () => true
      )(request(body, { signal: abort.signal }))
    );
    expect(upstream).not.toHaveBeenCalled();
    const corrupt = vi.fn<typeof fetch>(async (_url, init) => {
      const payload = responsePayload(init);
      payload.capability.token += 'private-canary';
      return new Response(JSON.stringify(payload), { headers: responseHeaders });
    });
    await denied(await createOptInHandler(options(corrupt), () => true)(request()));
    expect(corrupt).toHaveBeenCalledOnce();
  });
});
