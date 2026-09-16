import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import credential from '../packages/contracts/fixtures/api-key-credential.v1.json';
import binding from '../packages/contracts/fixtures/submission-binding.v1.json';
import { BugDrop } from '../packages/server/src/index.js';

describe('Stage 0 managed exchange boundary', () => {
  it.each([401, 403, 429, 500, 503])('never falls back after HTTP %s', async (status) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('', { status }));
    const client = new BugDrop({ apiKey: credential.apiKey, fetch });
    await expect(client.createSubmissionToken(binding.bound)).rejects.toMatchObject({
      code: 'request_failed',
      status,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe('https://api.bugdrop.dev/v1/submission-capabilities');
  });

  it.each(['network', 'malformed response'])('never falls back after %s', async (failure) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    if (failure === 'network') fetch.mockRejectedValue(new Error(credential.authorization));
    else fetch.mockResolvedValue(new Response('not JSON'));
    await expect(
      new BugDrop({ apiKey: credential.apiKey, fetch }).createSubmissionToken(binding.bound)
    ).rejects.toThrow(/^BugDrop returned|^Unable to reach/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    'subject',
    'userId',
    'reporterId',
    'pseudonym',
    'applicationId',
    'tenantId',
    'repository',
    'installationId',
    'labels',
    'flow',
    'apiKey',
  ])('rejects %s independently before any network call', async (field) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new BugDrop({ apiKey: credential.apiKey, fetch });
    await expect(
      client.createSubmissionToken({ ...binding.bound, [field]: 'forbidden-canary' })
    ).rejects.toThrow('unsupported fields');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('blocks an actual HTTP redirect before leaking the derived bearer or retrying', async () => {
    const paths: string[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url!);
      response.writeHead(307, { Location: '/anonymous-public' }).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local address');
    try {
      const client = new BugDrop({
        apiKey: credential.apiKey,
        endpoint: `http://127.0.0.1:${address.port}/managed`,
      });
      await expect(client.createSubmissionToken(binding.bound)).rejects.toMatchObject({
        code: 'request_failed',
      });
      expect(paths).toEqual(['/managed']);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
