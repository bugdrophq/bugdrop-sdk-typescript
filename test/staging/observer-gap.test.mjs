import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { installConsumer, readFixtures } from '../../scripts/integration/packed-consumer.mjs';
import { safetyProvider } from '../../scripts/staging/safety-provider.mjs';
import { context, runId, snapshot } from './safety-support.mjs';

test('real packed SDK 503 or transport failure before observer admission cannot prove zero traffic', async () => {
  const consumer = await installConsumer(process.cwd());
  let mode,
    requests = 0;
  const server = createServer((request, response) => {
    requests++;
    request.resume();
    if (mode === 'transport') request.socket.destroy();
    else {
      response.writeHead(503);
      response.end('{"error":"staging_observation_unavailable"}');
    }
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    for (mode of ['503', 'transport']) {
      const input = context();
      input.consumer = consumer;
      input.fixtures = await readFixtures(process.cwd());
      input.target = {
        ...input.target,
        endpoint: `http://127.0.0.1:${server.address().port}/v1/submission-capabilities`,
      };
      input.service.endpoint = input.target.endpoint;
      input.service.resolveApiKey = async () =>
        `bd_api_v1.${randomBytes(16).toString('base64url')}.${randomBytes(32).toString('base64url')}`;
      // The independent observer never admitted these requests, despite actual HTTP activity.
      input.service.readExchangeCount = async () => snapshot(0);
      const bridge = await safetyProvider(input).startScenario({
        scenario: 'origin-aliases',
        runId,
      });
      const before = requests;
      try {
        await assert.rejects(
          bridge.mint({
            binding: input.fixtures['submission-binding'].bound,
            origin: input.target.origin,
          }),
          { code: 'request_failed', status: mode === '503' ? 503 : undefined }
        );
        assert.ok(requests > before);
        assert.equal((await input.service.readExchangeCount()).count, 0);
        await assert.rejects(bridge.readExchangeCount());
        await assert.rejects(bridge.evidence());
      } finally {
        await assert.rejects(bridge.close());
      }
      assert.equal(input.service.closed, 1);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await consumer.close();
  }
});
