import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { installConsumer, readFixtures } from '../../scripts/integration/packed-consumer.mjs';
import { assertSafetyRunner } from '../../scripts/staging/safety.mjs';
import { completionReceipt } from '../../scripts/staging/receipt.mjs';
import { contract, runId } from './safety-support.mjs';
import { target } from './support.mjs';
import { providerObserverFixture } from './provider-observer-support.mjs';

const repository = resolve(import.meta.dirname, '../..');
let consumer, fixtures;
before(async () => {
  consumer = await installConsumer(repository);
  fixtures = await readFixtures(repository);
});
after(async () => consumer?.close());

test('current packed candidate cannot use the default frozen HTTP fixture', async () => {
  assert.equal(consumer.versions.server, '0.2.1');
  const binding = fixtures['submission-binding'].bound;
  const local = await providerObserverFixture(target, binding.payloadDigest);
  const service = await local.provider.startSafetyScenario({ scenario: 'origin-aliases', runId });
  try {
    const client = new consumer.BugDrop({
      apiKey: await service.resolveApiKey(),
      endpoint: local.endpoint,
    });
    await assert.rejects(client.createSubmissionToken({ ...binding, origin: target.origin }), {
      code: 'request_failed',
      status: 400,
    });
    assert.equal(local.records[0].networkRequests, 1);
    assert.deepEqual(local.records[0].observer.state.exchanges, []);
    assert.equal((await service.readExchangeCount()).count, 0);
    await service.close();
  } finally {
    await local.close();
  }
});

test('candidate HTTP transport does not inherit frozen signed-observer qualification', async () => {
  const binding = fixtures['submission-binding'].bound;
  const local = await providerObserverFixture(
    target,
    binding.payloadDigest,
    consumer.versions.server
  );
  const service = await local.provider.startSafetyScenario({ scenario: 'origin-aliases', runId });
  try {
    const client = new consumer.BugDrop({
      apiKey: await service.resolveApiKey(),
      endpoint: local.endpoint,
    });
    assert.equal(
      (await client.createSubmissionToken({ ...binding, origin: target.origin })).schemaVersion,
      1
    );
    assert.equal(local.records[0].observer.state.exchanges[0].sdkVersion, '0.2.1');
    await assert.rejects(service.readExchangeCount(), /staging_observation_incomplete/);
    await assert.rejects(
      service.evidence({ sdkAttemptTranscript: { scenario: 'origin-aliases' } }),
      /staging_observation_incomplete/
    );
    await assert.rejects(service.close(), /staging_observation_incomplete/);
    assert.equal(local.records[0].closed, true);
    assert.throws(() =>
      assertSafetyRunner(
        { packedSdkSafetyContract: contract, runRemoteSafety() {} },
        consumer.versions.server
      )
    );
    assert.throws(() => completionReceipt({ target, runId, sdkVersion: consumer.versions.server }));
  } finally {
    await local.close();
  }
});
