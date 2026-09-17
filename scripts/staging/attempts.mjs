import assert from 'node:assert/strict';

// SDK invocation observations supplement remote evidence; they are not an HTTP collector.
export function observeAttempts(client, { runId, scenario, applicationId, sdkVersion }) {
  const attempts = [];
  const active = new Set();
  let sealed = false;
  let incomplete = false;
  const invalidate = () => {
    incomplete = true;
  };
  const snapshot = () =>
    Object.freeze({
      schemaVersion: 1,
      runId,
      scenario,
      applicationId,
      sdkVersion,
      complete: !incomplete && attempts.every(({ outcome }) => outcome !== 'pending'),
      attempts: Object.freeze(attempts.map((attempt) => Object.freeze({ ...attempt }))),
    });
  const network = () => {
    assert.equal(snapshot().complete, true, 'SDK attempt evidence incomplete');
    return attempts.filter(({ outcome }) => ['capability_issued', 'http_denied'].includes(outcome));
  };
  return {
    snapshot,
    invalidate,
    assertComplete: () => network(),
    async drain() {
      sealed = true;
      if (active.size === 0) return;
      invalidate();
      const pending = [...active];
      for (const call of pending) call.controller.abort();
      let timer;
      try {
        await Promise.race([
          Promise.all(pending.map((call) => call.done)),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('SDK drain incomplete')), 2000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    async invoke(options, localRejection) {
      if (sealed) {
        invalidate();
        throw new Error('SDK scenario closed');
      }
      const controller = new AbortController();
      let settled;
      const call = {
        controller,
        done: new Promise((resolve) => {
          settled = resolve;
        }),
      };
      active.add(call);
      const entry = { sequence: attempts.length + 1, outcome: 'pending', status: null };
      attempts.push(entry);
      try {
        const result = await client.createSubmissionToken({
          ...options,
          signal: options.signal
            ? AbortSignal.any([options.signal, controller.signal])
            : controller.signal,
        });
        assert.equal(localRejection, undefined, 'Expected SDK local rejection');
        entry.outcome = 'capability_issued';
        return result;
      } catch (error) {
        const local =
          error instanceof TypeError &&
          ((localRejection === 'origin' && /^origin must /.test(error.message)) ||
            (localRejection === 'unsupported' &&
              Object.hasOwn(options, 'userId') &&
              error.message === 'createSubmissionToken options contain unsupported fields'));
        if (local)
          entry.outcome =
            localRejection === 'origin' ? 'local_origin_rejected' : 'local_input_rejected';
        else if (error?.code === 'request_failed' && error.status === 403) {
          entry.outcome = 'http_denied';
          entry.status = 403;
          if (localRejection !== undefined) invalidate();
        } else {
          entry.status =
            Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599
              ? error.status
              : null;
          entry.outcome =
            error?.code === 'request_failed'
              ? entry.status === null
                ? 'transport_error'
                : 'http_error'
              : 'sdk_error';
          invalidate();
        }
        throw error;
      } finally {
        active.delete(call);
        settled();
      }
    },
    assertCount(count) {
      assert.equal(count, network().length, 'SDK and observer exchange counts differ');
    },
    assertExchanges(exchanges) {
      const expected = network();
      assert.ok(Array.isArray(exchanges));
      assert.equal(exchanges.length, expected.length);
      for (const [index, exchange] of exchanges.entries()) {
        assert.equal(exchange.sequence, index + 1);
        assert.equal(exchange.sdkVersion, sdkVersion);
        if (expected[index].outcome === 'http_denied') assert.equal(exchange.status, 403);
        else
          assert.ok(
            Number.isInteger(exchange.status) && exchange.status >= 200 && exchange.status < 300
          );
      }
    },
  };
}
