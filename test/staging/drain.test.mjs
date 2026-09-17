import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safetyProvider } from '../../scripts/staging/safety-provider.mjs';
import { observeAttempts } from '../../scripts/staging/attempts.mjs';
import { context, runId } from './safety-support.mjs';

test('pending SDK invocation is aborted and settled before provider lease cleanup', async () => {
  let invoked,
    aborted = false,
    settled = false;
  const entered = new Promise((resolve) => {
    invoked = resolve;
  });
  const input = context(
    class {
      createSubmissionToken({ signal }) {
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            settled = true;
            reject(Object.assign(new Error('aborted'), { code: 'request_failed' }));
          });
          invoked();
        });
      }
    }
  );
  input.service.close = () => {
    assert.equal(settled, true);
    input.service.closed++;
  };
  const provider = safetyProvider(input);
  const bridge = await provider.startScenario({ scenario: 'origin-aliases', runId });
  const pending = bridge.mint({ binding: {}, origin: input.target.origin });
  const rejected = assert.rejects(pending);
  await entered;
  await assert.rejects(bridge.close());
  await rejected;
  assert.equal(aborted, true);
  assert.equal(input.service.closed, 1);
  await assert.rejects(provider.startScenario({ scenario: 'retention-deletion', runId }));
});

test('unsettled prior invocation cannot open a next window even after modeled lease expiry', async () => {
  let release, signal;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const input = context(
    class {
      createSubmissionToken(options) {
        signal = options.signal;
        return held;
      }
    }
  );
  let starts = 0;
  input.provider.startSafetyScenario = async () => {
    starts++;
    return input.service;
  };
  const provider = safetyProvider(input);
  const bridge = await provider.startScenario({ scenario: 'origin-aliases', runId });
  const invocation = bridge.mint({ binding: {}, origin: input.target.origin });
  await assert.rejects(bridge.close(), /drain incomplete/);
  assert.equal(signal.aborted, true);
  assert.equal(input.service.closed, 1);
  // A remote provider may now permit a new lease after TTL; the run must not ask for it.
  await assert.rejects(provider.startScenario({ scenario: 'retention-deletion', runId }));
  release({ schemaVersion: 1, token: 'late-test-only-result' });
  await invocation;
  await assert.rejects(provider.startScenario({ scenario: 'retention-deletion', runId }));
  assert.equal(starts, 1);
});

test('settled healthy scenario can close but cannot invoke the SDK again', async () => {
  let calls = 0;
  const observed = observeAttempts(
    {
      async createSubmissionToken() {
        calls++;
        return {};
      },
    },
    { runId, scenario: 'origin', applicationId: 'test', sdkVersion: '0.1.0' }
  );
  await observed.invoke({});
  await observed.drain();
  observed.assertComplete();
  await assert.rejects(observed.invoke({}), /scenario closed/);
  assert.equal(calls, 1);
});
