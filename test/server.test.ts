import fixture from '../packages/contracts/fixtures/api-key-credential.v1.json';
import { describe, expect, it, vi } from 'vitest';
import { BugDrop, BugDropServerError } from '../packages/server/src/index.js';

const response = {
  schemaVersion: 1 as const,
  token: 'opaque-capability',
  expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
};

describe('@bugdrop/server', () => {
  it('creates an application-scoped token without an end-user identifier', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(response));
    const client = new BugDrop({ apiKey: fixture.apiKey, fetch });

    await expect(client.createSubmissionToken()).resolves.toEqual(response);

    const [url, init] = fetch.mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({ schemaVersion: 1 });
    expect(init?.headers).toMatchObject({
      Accept: 'application/vnd.bugdrop.submission-capability.v1+json',
      Authorization: fixture.authorization,
      'Content-Type': 'application/json',
      'X-BugDrop-Contract-Version': '1',
    });
    expect(JSON.stringify({ url, init })).not.toContain(fixture.apiKey);
    expect(JSON.stringify({ url, init })).not.toContain(fixture.rootSecret);
    expect(init?.redirect).toBe('error');
  });

  it('sends optional Application context without adding user identity', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(response));
    const client = new BugDrop({ apiKey: fixture.apiKey, fetch });

    await client.createSubmissionToken({
      origin: 'https://app.example.com',
      environment: 'production',
    });

    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      schemaVersion: 1,
      origin: 'https://app.example.com',
      environment: 'production',
    });
  });

  it('rejects caller-supplied Application and repository authority before exchange', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(response));
    const client = new BugDrop({ apiKey: fixture.apiKey, fetch });
    await expect(
      client.createSubmissionToken({
        ...({
          applicationId: 'app_public_other',
          repo: 'attacker/private',
          labels: ['p0'],
          flow: 'privileged',
        } as Record<string, unknown>),
      })
    ).rejects.toThrow('unsupported fields');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects end-user identity fields before exchange', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(response));
    const client = new BugDrop({ apiKey: fixture.apiKey, fetch });
    await expect(
      client.createSubmissionToken({ subject: 'customer-user-42' } as never)
    ).rejects.toThrow('unsupported fields');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not expose the configured API key through properties or serialization', () => {
    const client = new BugDrop({ apiKey: fixture.apiKey, fetch: vi.fn() });
    expect(Object.keys(client)).toEqual([]);
    expect(JSON.stringify(client)).toBe('"[BugDrop server client]"');
    expect(JSON.stringify(client)).not.toContain(fixture.apiKey);
    expect(String(client)).not.toContain(fixture.apiKey);
  });

  it('redacts remote response bodies and network errors', async () => {
    const reflected = `${fixture.apiKey} ${fixture.rootSecret} opaque-capability-from-error`;
    const rejectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(reflected, { status: 401 }));
    const client = new BugDrop({ apiKey: fixture.apiKey, fetch: rejectedFetch });

    let thrown: unknown;
    try {
      await client.createSubmissionToken();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BugDropServerError);
    expect(thrown).toMatchObject({ code: 'request_failed', status: 401 });
    expect(JSON.stringify(thrown)).not.toContain(fixture.apiKey);
    expect(JSON.stringify(thrown)).not.toContain(fixture.rootSecret);
    expect(String(thrown)).not.toContain('opaque-capability-from-error');

    const networkClient = new BugDrop({
      apiKey: fixture.apiKey,
      fetch: vi.fn(() => Promise.reject(new Error(reflected))),
    });
    await expect(networkClient.createSubmissionToken()).rejects.toMatchObject({
      code: 'request_failed',
    });
    await expect(networkClient.createSubmissionToken()).rejects.not.toThrow(reflected);
  });

  it('rejects insecure or credential-bearing endpoints', () => {
    expect(
      () => new BugDrop({ apiKey: fixture.apiKey, endpoint: 'http://example.com/token' })
    ).toThrow('must use HTTPS');
    expect(
      () =>
        new BugDrop({
          apiKey: fixture.apiKey,
          endpoint: 'https://user:pass@example.com/token',
        })
    ).toThrow('must use HTTPS');
  });

  it('rejects capabilities with more than five minutes remaining', async () => {
    const overlong = {
      ...response,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    const client = new BugDrop({
      apiKey: fixture.apiKey,
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(overlong)),
    });
    await expect(client.createSubmissionToken()).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

describe('@bugdrop/server input validation', () => {
  it.each([undefined, '', 'short', ` ${fixture.apiKey}`])(
    'rejects invalid API key %s',
    (apiKey) => {
      expect(() => new BugDrop({ apiKey, fetch: vi.fn() })).toThrow('valid API key');
    }
  );

  it('rejects invalid operation objects', async () => {
    const client = new BugDrop({ apiKey: fixture.apiKey, fetch: vi.fn() });
    await expect(client.createSubmissionToken(null as never)).rejects.toThrow('options object');
  });

  it.each([
    [{ origin: 'not a URL' }, 'origin'],
    [{ origin: 'https://example.com/path' }, 'origin'],
    [{ environment: 'bad environment!' }, 'environment'],
  ])('rejects malformed exchange option %#', async (options, message) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new BugDrop({ apiKey: fixture.apiKey, fetch });
    await expect(client.createSubmissionToken(options)).rejects.toThrow(message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['not a URL', 'valid URL'],
    ['https://example.com/token?secret=value', 'query string'],
    ['https://example.com/token#fragment', 'query string'],
  ])('rejects malformed endpoint %s', (endpoint, message) => {
    expect(() => new BugDrop({ apiKey: fixture.apiKey, endpoint })).toThrow(message);
  });

  it.each([0, 60_001, Number.NaN])('rejects invalid timeout %s', (timeoutMs) => {
    expect(() => new BugDrop({ apiKey: fixture.apiKey, timeoutMs })).toThrow('timeoutMs');
  });

  it('accepts an HTTP localhost endpoint for local contract testing', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(response));
    const client = new BugDrop({
      apiKey: fixture.apiKey,
      endpoint: 'http://sdk.localhost/v1/submission-capabilities',
      fetch,
    });
    await expect(client.createSubmissionToken()).resolves.toEqual(response);
  });

  it('wraps malformed successful responses without exposing their contents', async () => {
    const reflected = `${fixture.apiKey}-opaque-capability-from-error`;
    const client = new BugDrop({
      apiKey: fixture.apiKey,
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(Response.json({ token: reflected })),
    });
    let thrown: unknown;
    try {
      await client.createSubmissionToken();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'invalid_response', status: 200 });
    expect(String(thrown)).not.toContain(reflected);
  });
});
