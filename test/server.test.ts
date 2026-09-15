import fixture from '../packages/contracts/fixtures/api-key-credential.v1.json';
import { describe, expect, it, vi } from 'vitest';
import { BugDrop, BugDropServerError } from '../packages/server/src/index.js';

const rotatedApiKey =
  'bd_api_v1.AAECAwQFBgcICQoLDA0ODw.MDEyMzQ1Njc4OTo7PD0-P0BBQkNERUZHSElKS0xNTk8';
const response = {
  schemaVersion: 1 as const,
  token: 'opaque-capability',
  expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
};

describe('@bugdrop/server', () => {
  it('exchanges a subject using API-key-derived identity and no authority selectors', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(response));
    const client = new BugDrop({ apiKey: fixture.apiKey, fetch });

    await expect(
      client.createSubmissionToken({
        subject: fixture.subject,
        origin: 'https://app.example.com',
        environment: 'production',
      })
    ).resolves.toEqual(response);

    const [url, init] = fetch.mock.calls[0]!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      schemaVersion: 1,
      subject: fixture.pseudonym,
      origin: 'https://app.example.com',
      environment: 'production',
    });
    expect(init?.headers).toMatchObject({
      Accept: 'application/vnd.bugdrop.submission-capability.v1+json',
      Authorization: fixture.authorization,
      'Content-Type': 'application/json',
      'X-BugDrop-Contract-Version': '1',
    });
    expect(JSON.stringify({ url, init })).not.toContain(fixture.subject);
    expect(JSON.stringify({ url, init })).not.toContain(fixture.apiKey);
    expect(JSON.stringify({ url, init })).not.toContain(fixture.rootSecret);
    expect(init?.redirect).toBe('error');
  });

  it('rejects caller-supplied Application and repository authority before exchange', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(response));
    const client = new BugDrop({ apiKey: fixture.apiKey, fetch });
    await expect(
      client.createSubmissionToken({
        subject: fixture.subject,
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

  it('uses different pseudonyms for the same subject under different API keys', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => Promise.resolve(Response.json(response)));
    const firstClient = new BugDrop({ apiKey: fixture.apiKey, fetch });
    const rotatedClient = new BugDrop({ apiKey: rotatedApiKey, fetch });

    await firstClient.createSubmissionToken({ subject: fixture.subject });
    await rotatedClient.createSubmissionToken({ subject: fixture.subject });

    const firstBody = JSON.parse(String(fetch.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    const rotatedBody = JSON.parse(String(fetch.mock.calls[1]![1]?.body)) as Record<
      string,
      unknown
    >;
    expect(firstBody.subject).not.toBe(rotatedBody.subject);
  });

  it('does not expose the configured API key through properties or serialization', () => {
    const client = new BugDrop({ apiKey: fixture.apiKey, fetch: vi.fn() });
    expect(Object.keys(client)).toEqual([]);
    expect(JSON.stringify(client)).toBe('"[BugDrop server client]"');
    expect(JSON.stringify(client)).not.toContain(fixture.apiKey);
    expect(String(client)).not.toContain(fixture.apiKey);
  });

  it('redacts remote response bodies and network errors', async () => {
    const reflected = `${fixture.apiKey} ${fixture.rootSecret} ${fixture.subject} opaque-capability-from-error`;
    const rejectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(reflected, { status: 401 }));
    const client = new BugDrop({ apiKey: fixture.apiKey, fetch: rejectedFetch });

    let thrown: unknown;
    try {
      await client.createSubmissionToken({ subject: fixture.subject });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BugDropServerError);
    expect(thrown).toMatchObject({ code: 'request_failed', status: 401 });
    expect(JSON.stringify(thrown)).not.toContain(fixture.apiKey);
    expect(JSON.stringify(thrown)).not.toContain(fixture.rootSecret);
    expect(String(thrown)).not.toContain(fixture.subject);
    expect(String(thrown)).not.toContain('opaque-capability-from-error');

    const networkClient = new BugDrop({
      apiKey: fixture.apiKey,
      fetch: vi.fn(() => Promise.reject(new Error(reflected))),
    });
    await expect(
      networkClient.createSubmissionToken({ subject: fixture.subject })
    ).rejects.toMatchObject({
      code: 'request_failed',
    });
    await expect(
      networkClient.createSubmissionToken({ subject: fixture.subject })
    ).rejects.not.toThrow(reflected);
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
    await expect(client.createSubmissionToken({ subject: fixture.subject })).rejects.toMatchObject({
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
    [{ subject: fixture.subject, origin: 'not a URL' }, 'origin'],
    [{ subject: fixture.subject, origin: 'https://example.com/path' }, 'origin'],
    [{ subject: fixture.subject, environment: 'bad environment!' }, 'environment'],
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
    await expect(client.createSubmissionToken({ subject: fixture.subject })).resolves.toEqual(
      response
    );
  });

  it('wraps malformed successful responses without exposing their contents', async () => {
    const reflected = `${fixture.apiKey}-${fixture.subject}`;
    const client = new BugDrop({
      apiKey: fixture.apiKey,
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(Response.json({ token: reflected })),
    });
    let thrown: unknown;
    try {
      await client.createSubmissionToken({ subject: fixture.subject });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'invalid_response', status: 200 });
    expect(String(thrown)).not.toContain(reflected);
  });
});
