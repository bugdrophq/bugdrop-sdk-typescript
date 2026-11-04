import { expect, it, vi } from 'vitest';
import { createCapabilityHandler } from '@bugdrop/server/adapter';
import { failureReporter } from '../packages/server/src/adapter-diagnostics.js';
import { denied, options, request } from './helpers/adapter-fixture.js';
it('emits immutable sanitized allowlisted metadata at most once', () => {
  const observer = vi.fn();
  const report = failureReporter(observer);
  report({
    phase: 'invalid',
    reason: 'secret',
    issuerContacted: 'yes',
    httpStatus: 999,
    keyPresent: true,
    token: 'canary',
  } as never);
  report({ phase: 'body', reason: 'failed', issuerContacted: false });
  expect(observer).toHaveBeenCalledTimes(1);
  const event = observer.mock.calls[0]![0];
  expect(event).toEqual({
    phase: 'sdk_init',
    reason: 'failed',
    issuerContacted: false,
    keyPresent: true,
  });
  expect(Object.isFrozen(event)).toBe(true);
});
it('isolates synchronous throws and rejected observers', async () => {
  for (const observeFailure of [
    () => {
      throw new Error('secret');
    },
    async () => {
      throw new Error('secret');
    },
  ]) {
    await denied(
      await createCapabilityHandler({ ...options(), apiKey: 'secret', observeFailure })(request())
    );
  }
});
it('reports issuer metadata without upstream error text or body', async () => {
  const observeFailure = vi.fn();
  await denied(
    await createCapabilityHandler({
      ...options(async () => new Response('secret', { status: 403 })),
      observeFailure,
    })(request())
  );
  expect(observeFailure).toHaveBeenCalledExactlyOnceWith({
    phase: 'issuer_exchange',
    reason: 'failed',
    issuerContacted: true,
    httpStatus: 403,
  });
});
