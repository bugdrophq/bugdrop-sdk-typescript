import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import credential from '../packages/contracts/fixtures/api-key-credential.v1.json';
import bindingFixture from '../packages/contracts/fixtures/submission-binding.v1.json';
import originFixture from '../packages/contracts/fixtures/origin.v1.json';
import { createV1Handler } from '../examples/v1-backend/handler.js';

const origin = 'https://app.example.com';
const url = `${origin}/api/bugdrop-capability/v1`;
const binding = bindingFixture.bound;
const body = JSON.stringify(binding);
const capability = () => ({
  schemaVersion: 1,
  token: 'local-fixture-capability',
  expiresAt: new Date(Date.now() + 240_000).toISOString(),
});
const makeRequest = (content: BodyInit = body, init: RequestInit = {}, target = url) =>
  new Request(target, {
    method: 'POST',
    body: content,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-BugDrop-CSRF-Token': 'csrf-fixture',
    },
    ...init,
  });
const upstream = () =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(capability()), {
        headers: { 'Content-Type': 'application/json' },
      })
  );
const options = (fetch: typeof globalThis.fetch) => ({
  apiKey: credential.apiKey,
  origin,
  environment: 'staging',
  endpoint: 'https://api.example.com/v1/submission-capabilities',
  fetch,
});
const policy = (request: Request) =>
  request.headers.get('X-BugDrop-CSRF-Token') === 'csrf-fixture' &&
  request.headers.get('Cookie') === 'session=fixture';
const authorized = (content: BodyInit = body, init: RequestInit = {}, target = url) =>
  makeRequest(
    content,
    {
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-BugDrop-CSRF-Token': 'csrf-fixture',
        Cookie: 'session=fixture',
      },
      ...init,
    },
    target
  );
async function denied(response: Response) {
  expect(response.status).toBe(502);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  expect(await response.text()).toBe('{"error":"unable_to_authorize_bugdrop"}');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-02T12:00:00.000Z');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('V1 customer backend boundary', () => {
  it('requires a customer policy and canonical configured origin at startup', () => {
    for (const bad of [undefined, null, true]) {
      expect(() => createV1Handler(options(upstream()), bad as never)).toThrow('policy');
    }
    expect(() =>
      createV1Handler({ ...options(upstream()), origin: 'https://app.example.com/' }, policy)
    ).toThrow('origin');
    expect(() =>
      createV1Handler({ ...options(upstream()), origin: 'http://app.example.com' }, policy)
    ).toThrow('origin');
  });

  it('uses only trusted authority and forwards only validated binding', async () => {
    const exchange = upstream();
    const result = await createV1Handler(
      options(exchange),
      policy
    )(
      authorized(body, {
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'X-BugDrop-CSRF-Token': 'csrf-fixture',
          Cookie: 'session=fixture',
          Authorization: 'private-canary',
          'X-User-Id': 'private-canary',
        },
      })
    );
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(await result.json()).toEqual(capability());
    expect(exchange).toHaveBeenCalledOnce();
    const [target, init] = exchange.mock.calls[0]!;
    expect(target).toBe('https://api.example.com/v1/submission-capabilities');
    expect(JSON.parse(String(init?.body))).toEqual({
      schemaVersion: 1,
      ...binding,
      origin,
      environment: 'staging',
    });
    expect(new Headers(init?.headers).get('Authorization')).toBe(credential.authorization);
    expect(JSON.stringify(init)).not.toContain('private-canary');
    expect(init?.redirect).toBe('manual');
  });

  it.each([false, undefined, 'true', 1])('fails closed for policy result %#', async (answer) => {
    const exchange = upstream();
    const handler = createV1Handler(options(exchange), () => answer as boolean);
    await denied(await handler(authorized()));
    expect(exchange).not.toHaveBeenCalled();
  });

  it.each(['', 'invalid'])(
    'rejects missing or invalid CSRF token through customer policy',
    async (token) => {
      const exchange = upstream();
      const headers: Record<string, string> = {
        Origin: origin,
        'Content-Type': 'application/json',
        Cookie: 'session=fixture',
      };
      if (token) headers['X-BugDrop-CSRF-Token'] = token;
      await denied(
        await createV1Handler(options(exchange), policy)(makeRequest(body, { headers }))
      );
      expect(exchange).not.toHaveBeenCalled();
    }
  );

  it.each([
    [url, { headers: { 'Content-Type': 'application/json' } }],
    [url, { headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' } }],
    [url, { method: 'PUT' }],
    [url + '?next=1', {}],
    [url + '/', {}],
    [url, { headers: { Origin: origin, 'Content-Type': 'text/plain' } }],
    [
      url,
      {
        headers: { Origin: origin, 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
      },
    ],
  ] as const)('rejects origin, route, method and media mismatch %#', async (target, init) => {
    const exchange = upstream();
    const customerPolicy = vi.fn(() => true);
    await denied(
      await createV1Handler(options(exchange), customerPolicy)(makeRequest(body, init, target))
    );
    expect(customerPolicy).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });
});

describe('V1 customer backend body and upstream failures', () => {
  it.each([
    JSON.stringify({ ...binding, applicationId: 'app_attacker' }),
    JSON.stringify({ ...binding, origin: 'https://attacker.example' }),
    JSON.stringify({ ...binding, userId: 'private-canary' }),
    JSON.stringify({ ...binding, repository: 'private-canary' }),
    JSON.stringify({ ...binding, payloadDigest: 'bad' }),
    JSON.stringify({ ...binding, submissionId: ['id'] }),
    JSON.stringify({ ...binding, submissionId: '\ud800' }),
    JSON.stringify({ ...binding, submissionId: 'x'.repeat(201) }),
    body.replace('"submissionId":', '"submissionId":"earlier","submissionId":'),
    body.replace('"payloadDigest":', '"payloadDigest":"earlier","payload\\u0044igest":'),
    '{}',
    '[]',
    'null',
    '{',
    '\ufeff' + body,
    ' '.repeat(1025),
  ])('rejects malformed or authority-bearing body before exchange %#', async (content) => {
    const exchange = upstream();
    await denied(await createV1Handler(options(exchange), () => true)(makeRequest(content)));
    expect(exchange).not.toHaveBeenCalled();
  });

  it('does not let invalid binding values reserve customer policy state', async () => {
    const exchange = upstream();
    const customerPolicy = vi.fn(() => true);
    await denied(
      await createV1Handler(
        options(exchange),
        customerPolicy
      )(makeRequest(JSON.stringify({ ...binding, payloadDigest: 'bad' })))
    );
    expect(customerPolicy).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });

  it('rejects oversized streamed body even when cancel never resolves', async () => {
    const exchange = upstream();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1025));
      },
      cancel,
    });
    await denied(
      await createV1Handler(
        options(exchange),
        () => true
      )(makeRequest(stream, { duplex: 'half' } as RequestInit))
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(exchange).not.toHaveBeenCalled();
  });

  it.each(['1025', '01', '-1', '0', '1, 2'])(
    'rejects noncanonical or mismatched Content-Length %s',
    async (length) => {
      const exchange = upstream();
      await denied(
        await createV1Handler(
          options(exchange),
          () => true
        )(
          makeRequest(body, {
            headers: {
              Origin: origin,
              'Content-Type': 'application/json',
              'Content-Length': length,
            },
          })
        )
      );
      expect(exchange).not.toHaveBeenCalled();
    }
  );

  it.each([307, 503])('never retries or reflects upstream HTTP %s', async (status) => {
    const exchange = vi.fn<typeof fetch>(
      async () =>
        new Response('private-canary', {
          status,
          headers: status === 307 ? { Location: 'https://attacker.example' } : {},
        })
    );
    await denied(await createV1Handler(options(exchange), () => true)(makeRequest()));
    expect(exchange).toHaveBeenCalledOnce();
  });
});

describe('V1 origin fixture and binding-aware customer policy', () => {
  it.each(originFixture.valid)('accepts canonical configured origin %s', async (candidate) => {
    const exchange = upstream();
    const handler = createV1Handler({ ...options(exchange), origin: candidate }, () => true);
    const result = await handler(
      new Request(`${candidate}/api/bugdrop-capability/v1`, {
        method: 'POST',
        headers: { Origin: candidate, 'Content-Type': 'application/json' },
        body,
      })
    );
    expect(result.status).toBe(200);
    expect(exchange).toHaveBeenCalledOnce();
    expect(JSON.parse(String(exchange.mock.calls[0]![1]?.body)).origin).toBe(candidate);
  });

  it.each(originFixture.invalid)('rejects noncanonical or public HTTP origin %s', (candidate) => {
    expect(() =>
      createV1Handler({ ...options(upstream()), origin: candidate }, () => true)
    ).toThrow('origin');
  });

  it('passes frozen binding and rejects same ID with changed digest before a second exchange', async () => {
    const exchange = upstream();
    const recorded = new Map<string, string>();
    const customerPolicy = vi.fn((_request: Request, candidate: Readonly<typeof binding>) => {
      expect(Object.isFrozen(candidate)).toBe(true);
      const previous = recorded.get(candidate.submissionId);
      if (previous !== undefined && previous !== candidate.payloadDigest) return false;
      recorded.set(candidate.submissionId, candidate.payloadDigest);
      return true;
    });
    const handler = createV1Handler(options(exchange), customerPolicy);
    expect((await handler(makeRequest())).status).toBe(200);
    expect(exchange).toHaveBeenCalledOnce();
    const changed = { ...binding, payloadDigest: 'A'.repeat(43) };
    await denied(await handler(makeRequest(JSON.stringify(changed))));
    expect(customerPolicy).toHaveBeenCalledTimes(2);
    expect(exchange).toHaveBeenCalledOnce();
    expect(recorded.get(binding.submissionId)).toBe(binding.payloadDigest);
  });
});
