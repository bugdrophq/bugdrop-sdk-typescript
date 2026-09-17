import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observerFixture } from './observer-support.mjs';

test('private observer limits response bytes and drains a stalled body on deadline', async () => {
  for (const mode of ['oversize', 'body', 'transport']) {
    const { lease, state } = observerFixture();
    await lease.start();
    let aborted = false,
      canceled = false;
    state.mode = ({ init }) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
      });
      if (mode === 'transport') return new Promise(() => {});
      return new Response(
        new ReadableStream({
          start(controller) {
            if (mode === 'oversize') controller.enqueue(new Uint8Array(16385));
          },
          cancel() {
            canceled = true;
          },
        })
      );
    };
    await assert.rejects(lease.read(), { message: 'staging_observation_incomplete' });
    assert.equal(mode === 'oversize' ? canceled : aborted, true);
    if (mode === 'body') assert.equal(canceled, true);
    state.mode = undefined;
    await assert.rejects(lease.read());
    await assert.rejects(lease.close());
    assert.equal(state.calls.at(-1).path, '/observation/close');
  }
});
