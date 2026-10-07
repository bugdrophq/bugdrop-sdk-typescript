import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { checkService } from '../../scripts/integration/service-checks.mjs';
import { installConsumer, readFixtures } from '../../scripts/integration/packed-consumer.mjs';
import { serviceReplayFixture } from './service-replay-support.mjs';

const repository = resolve(import.meta.dirname, '../..');
let consumer, fixtures;
before(async () => {
  consumer = await installConsumer(repository);
  fixtures = await readFixtures(repository);
});
after(async () => consumer?.close());

test(
  'local harness tests same-token rejection and concurrent reminted-token receipt reuse',
  { timeout: 5000 },
  async () => {
    const model = serviceReplayFixture(fixtures, consumer.versions.server);
    await checkService({ ...consumer, BugDrop: model.BugDrop }, fixtures, model.start);
    for (const state of [model.closed[0], model.closed.at(-1)]) {
      assert.equal(state.minted.length, 3);
      assert.equal(new Set(state.minted).size, 3);
      assert.equal(state.attempts, 1);
      assert.equal(state.replacementWaiters.length, 2);
      assert.deepEqual(
        state.outcomes.map(({ outcome }) => outcome),
        [
          state.uncertain ? 'indeterminate' : 'delivered',
          'rejected',
          state.uncertain ? 'indeterminate' : 'delivered',
          state.uncertain ? 'indeterminate' : 'delivered',
          'rejected',
          'rejected',
        ]
      );
    }
  }
);

test('local harness rejects repeated mint tokens, second attempts, replay success and replacement leaks', async () => {
  for (const scenario of ['delivered', 'indeterminate']) {
    for (const fault of [
      'duplicateToken',
      'duplicateAttempt',
      'replaySuccess',
      'replacementReplaySuccess',
      'leakReplacement',
    ]) {
      const model = serviceReplayFixture(fixtures, consumer.versions.server, fault, scenario);
      await assert.rejects(
        checkService({ ...consumer, BugDrop: model.BugDrop }, fixtures, model.start)
      );
      assert.equal(model.closed.at(-1).uncertain, scenario === 'indeterminate');
    }
  }
});
