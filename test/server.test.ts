import { describe, expect, it, vi } from 'vitest';
import { BugDrop, BugDropServerError, pseudonymizeSubject } from '../packages/server/src/index.js';

const secret = 'bd_sk_test_server_only_1234567890';
const rawSubject = 'customer-user-42';
const response = {
  schemaVersion: 1 as const,
  token: 'opaque-capability',
  expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
};

describe('@bugdrop/server', () => {
  it('pseudonymizes the subject locally and forwards no authority selectors', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(response));
    const client = new BugDrop({ secretKey: secret, fetch });

    await expect(
      client.createSubmissionToken({
        subject: rawSubject,
        origin: 'https://app.example.com',
        environment: 'production',
      })
    ).resolves.toEqual(response);

    const [url, init] = fetch.mock.calls[0]!;
    const serializedRequest = JSON.stringify({ url, init });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      schemaVersion: 1,
      subject: pseudonymizeSubject(rawSubject, secret),
      origin: 'https://app.example.com',
      environment: 'production',
    });
    expect(body.subject).not.toBe(rawSubject);
    expect(serializedRequest).not.toContain(rawSubject);
    expect(init?.headers).toMatchObject({
      Accept: 'application/vnd.bugdrop.submission-capability.v1+json',
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      'X-BugDrop-Contract-Version': '1',
    });
    expect(init?.redirect).toBe('error');
  });

  it('rejects caller-supplied Application and repository authority before exchange', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(response));
    const client = new BugDrop({ secretKey: secret, fetch });
    await expect(
      client.createSubmissionToken({
        subject: rawSubject,
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

  it('uses an Application-scoped pseudonym', () => {
    expect(pseudonymizeSubject(rawSubject, secret)).not.toBe(
      pseudonymizeSubject(rawSubject, 'bd_sk_a_different_application_123456')
    );
  });

  it('does not expose the configured secret through properties or serialization', () => {
    const client = new BugDrop({ secretKey: secret, fetch: vi.fn() });
    expect(Object.keys(client)).toEqual([]);
    expect(JSON.stringify(client)).toBe('"[BugDrop server client]"');
    expect(JSON.stringify(client)).not.toContain(secret);
    expect(String(client)).not.toContain(secret);
  });

  it('redacts remote response bodies and network errors', async () => {
    const reflected = `${secret} ${rawSubject} opaque-capability-from-error`;
    const rejectedFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(reflected, { status: 401 }));
    const client = new BugDrop({ secretKey: secret, fetch: rejectedFetch });

    let thrown: unknown;
    try {
      await client.createSubmissionToken({ subject: rawSubject });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BugDropServerError);
    expect(thrown).toMatchObject({ code: 'request_failed', status: 401 });
    expect(JSON.stringify(thrown)).not.toContain(secret);
    expect(String(thrown)).not.toContain(rawSubject);
    expect(String(thrown)).not.toContain('opaque-capability-from-error');

    const networkClient = new BugDrop({
      secretKey: secret,
      fetch: vi.fn(() => Promise.reject(new Error(reflected))),
    });
    await expect(
      networkClient.createSubmissionToken({ subject: rawSubject })
    ).rejects.toMatchObject({
      code: 'request_failed',
    });
    await expect(networkClient.createSubmissionToken({ subject: rawSubject })).rejects.not.toThrow(
      reflected
    );
  });

  it('rejects insecure or credential-bearing endpoints', () => {
    expect(() => new BugDrop({ secretKey: secret, endpoint: 'http://example.com/token' })).toThrow(
      'must use HTTPS'
    );
    expect(
      () => new BugDrop({ secretKey: secret, endpoint: 'https://user:pass@example.com/token' })
    ).toThrow('must use HTTPS');
  });

  it('rejects capabilities with more than five minutes remaining', async () => {
    const overlong = {
      ...response,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    const client = new BugDrop({
      secretKey: secret,
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(overlong)),
    });
    await expect(client.createSubmissionToken({ subject: rawSubject })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

describe('@bugdrop/server input validation', () => {
  it.each([undefined, '', 'short', ' padded-secret-key-value '])(
    'rejects invalid secret %s',
    (secretKey) => {
      expect(() => new BugDrop({ secretKey, fetch: vi.fn() })).toThrow('server secret key');
    }
  );

  it('rejects invalid operation objects and pseudonymization keys', async () => {
    const client = new BugDrop({ secretKey: secret, fetch: vi.fn() });
    await expect(client.createSubmissionToken(null as never)).rejects.toThrow('options object');
    expect(() => pseudonymizeSubject('', secret)).toThrow('subject');
    expect(() => pseudonymizeSubject(rawSubject, 'short')).toThrow('secret key');
  });

  it.each([
    [{ subject: rawSubject, origin: 'not a URL' }, 'origin'],
    [{ subject: rawSubject, origin: 'https://example.com/path' }, 'origin'],
    [{ subject: rawSubject, environment: 'bad environment!' }, 'environment'],
  ])('rejects malformed exchange option %#', async (options, message) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new BugDrop({ secretKey: secret, fetch });
    await expect(client.createSubmissionToken(options)).rejects.toThrow(message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['not a URL', 'valid URL'],
    ['https://example.com/token?secret=value', 'query string'],
    ['https://example.com/token#fragment', 'query string'],
  ])('rejects malformed endpoint %s', (endpoint, message) => {
    expect(() => new BugDrop({ secretKey: secret, endpoint })).toThrow(message);
  });

  it.each([0, 60_001, Number.NaN])('rejects invalid timeout %s', (timeoutMs) => {
    expect(() => new BugDrop({ secretKey: secret, timeoutMs })).toThrow('timeoutMs');
  });

  it('accepts an HTTP localhost endpoint for local contract testing', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(response));
    const client = new BugDrop({
      secretKey: secret,
      endpoint: 'http://sdk.localhost/v1/submission-capabilities',
      fetch,
    });
    await expect(client.createSubmissionToken({ subject: rawSubject })).resolves.toEqual(response);
  });

  it('wraps malformed successful responses without exposing their contents', async () => {
    const reflected = `${secret}-${rawSubject}`;
    const client = new BugDrop({
      secretKey: secret,
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(Response.json({ token: reflected })),
    });
    let thrown: unknown;
    try {
      await client.createSubmissionToken({ subject: rawSubject });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'invalid_response', status: 200 });
    expect(String(thrown)).not.toContain(reflected);
  });
});
