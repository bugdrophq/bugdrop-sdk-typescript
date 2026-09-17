import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safetyProvider } from '../../scripts/staging/safety-provider.mjs';
import { assertOriginChecks } from '../../scripts/staging/origin-proof.mjs';
import { context, snapshot, completedResults, runId } from './safety-support.mjs';

class LocalRejectingClient {
  async createSubmissionToken() {
    throw new TypeError('origin must be an exact HTTPS origin');
  }
}

test('local validation requires complete, exclusive, scoped counters with zero delta', async () => {
  for (const change of [
    { runId: 'wrong-run' },
    { applicationId: 'wrong-app' },
    { scenario: 'uninstall' },
    { complete: false },
    { exclusive: false },
    { count: -1 },
    { count: 1.1 },
    { count: Number.MAX_SAFE_INTEGER + 1 },
    { count: undefined },
    { extra: true },
  ]) {
    const input = context(LocalRejectingClient);
    input.service.readExchangeCount = async () => ({ ...snapshot(), ...change });
    const bridge = await safetyProvider(input).startScenario({ scenario: 'origin-aliases', runId });
    try {
      await assert.rejects(
        bridge.rejectInvalidOrigin({ binding: {}, origin: `${input.target.origin}/` })
      );
    } finally {
      await bridge.close();
    }
  }
  for (const next of [0, 2]) {
    const input = context(LocalRejectingClient);
    let calls = 0;
    input.service.readExchangeCount = async () => snapshot(calls++ ? next : 1);
    const bridge = await safetyProvider(input).startScenario({ scenario: 'origin-aliases', runId });
    try {
      await assert.rejects(
        bridge.rejectInvalidOrigin({ binding: {}, origin: `${input.target.origin}/` })
      );
    } finally {
      await bridge.close();
    }
  }
});

test('reused mutable counter objects cannot hide network activity during local rejection', async () => {
  const shared = snapshot();
  const input = context(
    class {
      async createSubmissionToken() {
        shared.count++;
        throw new TypeError('origin must be canonical');
      }
    }
  );
  input.service.readExchangeCount = async () => shared;
  const bridge = await safetyProvider(input).startScenario({ scenario: 'origin-aliases', runId });
  try {
    await assert.rejects(
      bridge.rejectInvalidOrigin({ binding: {}, origin: `${input.target.origin}/` })
    );
  } finally {
    await bridge.close();
  }
});

test('HTTP errors and unrelated TypeErrors cannot masquerade as local origin validation', async () => {
  for (const error of [
    Object.assign(new Error('denied'), { code: 'request_failed', status: 403 }),
    new TypeError('binding invalid'),
  ]) {
    const input = context(
      class {
        async createSubmissionToken() {
          throw error;
        }
      }
    );
    const bridge = await safetyProvider(input).startScenario({ scenario: 'origin-aliases', runId });
    try {
      await assert.rejects(
        bridge.rejectInvalidOrigin({ binding: {}, origin: `${input.target.origin}/` })
      );
    } finally {
      await bridge.close();
    }
  }
});

test('final origin proof rejects unscoped, partial, or inconsistent network observations', () => {
  const input = context();
  const checks = () =>
    completedResults().find(({ scenario }) => scenario === 'origin-aliases').originChecks;
  assertOriginChecks(checks(), input);
  for (const mutate of [
    (value) => value.pop(),
    (value) => {
      value[0].after.count = 2;
    },
    (value) => {
      value[4].after.count = 1;
    },
    (value) => {
      value[4].before.count = 0;
    },
    (value) => {
      value[4].before.applicationId = 'another-app';
    },
    (value) => {
      value[4].networkAttempts = 0;
    },
    (value) => {
      value[4].outcome = 'client_validation_rejected';
    },
    (value) => {
      value[0].before.exclusive = false;
    },
  ]) {
    const value = checks();
    mutate(value);
    assert.throws(() => assertOriginChecks(value, input));
  }
});
