import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { installConsumer, readFixtures } from '../../scripts/integration/packed-consumer.mjs';
import { safetyProvider } from '../../scripts/staging/safety-provider.mjs';
import { context, runId, snapshot } from './safety-support.mjs';

test('safety mint uses the installed packed SDK and only classifies HTTP 403 as denial', async () => {
  const repository = resolve(import.meta.dirname, '../..');
  const consumer = await installConsumer(repository);
  const requests = [];
  let status = 200;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ headers: request.headers, body: JSON.parse(body) });
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        schemaVersion: 1,
        token: 'local-only-capability',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
    );
  });
  let bridge;
  let poisoned = false;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const input = context();
    input.consumer = consumer;
    input.fixtures = await readFixtures(repository);
    // This direct adapter self-test is local; real gate configuration rejects IP/HTTP targets.
    input.target = {
      ...input.target,
      endpoint: `http://127.0.0.1:${server.address().port}/v1/submission-capabilities`,
    };
    input.service.endpoint = input.target.endpoint;
    const apiKey = `bd_api_v1.${randomBytes(16).toString('base64url')}.${randomBytes(32).toString('base64url')}`;
    input.service.resolveApiKey = async () => apiKey;
    input.service.readExchangeCount = async () => snapshot(requests.length);
    bridge = await safetyProvider(input).startScenario({ scenario: 'origin-aliases', runId });
    const binding = input.fixtures['submission-binding'].bound;
    const mint = () => bridge.mint({ binding, origin: input.target.origin });
    assert.equal((await mint()).schemaVersion, 1);
    assert.equal(requests[0].headers['x-bugdrop-sdk-version'], consumer.versions.server);
    assert.deepEqual(requests[0].body, {
      schemaVersion: 1,
      ...binding,
      origin: input.target.origin,
    });
    assert.equal(requests[0].body.userId, undefined);
    assert.deepEqual(
      await bridge.rejectInvalidOrigin({ binding, origin: `${input.target.origin}/` }),
      {
        outcome: 'client_validation_rejected',
        networkAttempts: 0,
        before: snapshot(1),
        after: snapshot(1),
      }
    );
    assert.equal(requests.length, 1);
    status = 403;
    assert.equal(await bridge.mint({ binding, origin: 'https://wrong-origin.invalid' }), null);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].body.origin, 'https://wrong-origin.invalid');
    for (status of [401, 429, 500, 503]) {
      poisoned = true;
      await assert.rejects(mint(), { code: 'request_failed', status });
    }
    assert.equal(requests.length, 6);
    const markers = await bridge.secretMarkers();
    assert.ok(markers.includes(apiKey));
    assert.ok(markers.includes(requests[0].headers.authorization));
  } finally {
    if (poisoned) await assert.rejects(bridge.close());
    else await bridge?.close();
    await new Promise((resolve) => server.close(resolve));
    await consumer.close();
  }
});
