import assert from 'node:assert/strict';

export function counterSnapshot(value, { runId, target }) {
  assert.deepEqual(Object.keys(value).sort(), [
    'applicationId',
    'complete',
    'count',
    'exclusive',
    'runId',
    'scenario',
  ]);
  assert.equal(value.runId, runId);
  assert.equal(value.applicationId, target.applicationId);
  assert.equal(value.scenario, 'origin-aliases');
  assert.equal(value.complete, true);
  assert.equal(value.exclusive, true);
  assert.ok(Number.isSafeInteger(value.count) && value.count >= 0);
  // Keep the pre-call value even when a provider reuses a mutable observation object.
  return Object.freeze({ ...value });
}

export function assertOriginChecks(checks, context) {
  const origin = context.target.origin;
  const { hostname } = new URL(origin);
  const aliases = [
    origin.replace(hostname, `${hostname}.`),
    `https://${hostname}:443`,
    origin.replace(hostname, hostname.toUpperCase()),
    `${origin}/`,
  ].filter((alias) => alias !== origin);
  assert.equal(checks.length, aliases.length + 1);
  for (const [index, check] of checks.entries()) {
    assert.deepEqual(Object.keys(check).sort(), [
      'after',
      'before',
      'index',
      'networkAttempts',
      'outcome',
    ]);
    const before = counterSnapshot(check.before, context);
    const after = counterSnapshot(check.after, context);
    const isHttp = index === aliases.length;
    assert.equal(check.index, index);
    assert.equal(check.outcome, isHttp ? 'http_denied' : 'client_validation_rejected');
    assert.equal(check.networkAttempts, isHttp ? 1 : 0);
    // This isolated scenario begins with exactly one successful canonical-origin exchange.
    assert.equal(before.count, 1);
    assert.equal(after.count, isHttp ? 2 : 1);
  }
}
