import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { readConfiguration } from '../../scripts/heartbeat/config.mjs';
import { runHeartbeat } from '../../scripts/heartbeat/run.mjs';
import { feedbackFor, verifyIssue } from '../../scripts/heartbeat/verify.mjs';
const target = {
  fixtureOrigin: 'https://sdk-heartbeat.example',
  applicationId: 'app_synthetic',
  widgetUrl: 'https://widget.bugdrop.dev/widget.v1.js',
  issuerUrl: 'https://managed.bugdrop.dev/v1/submission-capabilities',
  submissionUrl: 'https://widget.bugdrop.dev/v1/submissions',
  repository: 'example/sdk-synthetic',
  author: 'bugdrop[bot]',
  labels: ['bug'],
  sdkCommit: 'a'.repeat(40),
  fixtureBundleSha256: 'b'.repeat(64),
  widgetSha256: 'c'.repeat(64),
};
const env = {
  BUGDROP_SDK_HEARTBEAT_ENABLED: '1',
  BUGDROP_SDK_HEARTBEAT_TARGET: JSON.stringify(target),
  BUGDROP_SDK_FIXTURE_PASSWORD: 'p'.repeat(32),
  MONITOR_SDK_HEARTBEAT_SECRET: 's'.repeat(32),
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '1',
};
const configured = readConfiguration(env);
const evidence = {
  postValidated: true,
  receiptId: '00000000-0000-4000-8000-000000000001',
  submissionId: '00000000-0000-4000-8000-000000000002',
};
const feedback = feedbackFor(configured);
const issue = {
  number: 1,
  title: feedback.title,
  body: feedback.description,
  state: 'open',
  html_url: 'https://github.com/example/sdk-synthetic/issues/1',
  user: { login: 'bugdrop[bot]' },
  labels: [{ name: 'bug' }],
};

test('disabled configuration requires no credentials and performs no work', () =>
  assert.equal(readConfiguration({}), null));
for (const changes of [
  { fixtureOrigin: 'https://foil.neonwatty.com' },
  { repository: 'grumpy-pig/debtisfun' },
  { fixtureOrigin: 'https://sdk-fixture-staging.bugdrop.dev' },
  { issuerUrl: 'https://api.bugdrop.dev/v1/submission-capabilities' },
  { fixtureBundleSha256: '' },
  { unexpected: true },
]) {
  test(`rejects an unsafe/unidentified target ${JSON.stringify(changes)}`, () =>
    assert.throws(() =>
      readConfiguration({
        ...env,
        BUGDROP_SDK_HEARTBEAT_TARGET: JSON.stringify({ ...target, ...changes }),
      })
    ));
}

test('success needs a validated single post, receipt and independent exact issue', () => {
  assert.equal(verifyIssue([issue], configured, evidence), 'issue_verified');
  assert.equal(
    verifyIssue([issue], configured, { ...evidence, postValidated: false }),
    'inconclusive'
  );
  assert.equal(
    verifyIssue([issue], configured, { ...evidence, receiptId: 'invalid' }),
    'inconclusive'
  );
  assert.equal(verifyIssue([], configured, evidence), 'issue_absent');
  assert.equal(verifyIssue([issue, issue], configured, evidence), 'issue_duplicate');
  for (const change of [
    { body: '' },
    { user: { login: 'wrong' } },
    { html_url: 'https://github.com/other/app/issues/1' },
    { labels: [] },
  ])
    assert.equal(
      verifyIssue([{ ...issue, ...change }], configured, evidence),
      'issue_contract_invalid'
    );
});

async function exercise({
  issues = [issue],
  browserError = false,
  cleanupError = false,
  cleanupMatches = issues.map((issue) => issue.number),
  incidentError = false,
  existing = [],
} = {}) {
  const calls = { cleaned: [], incidents: [], sent: [] };
  const helpers = {
    listMatchingIssues: async (options) => (options.prefix ? existing : issues),
    closeMatchingIssues: async (options) => {
      calls.cleaned.push(options);
      if (cleanupError || !cleanupMatches.length) throw new Error('cleanup');
      return { matchedNumbers: cleanupMatches, closedNumbers: cleanupMatches, openNumbers: [] };
    },
    transitionHeartbeatIncident: async (options) => {
      calls.incidents.push(options);
      if (incidentError) throw new Error('incident');
    },
    sendHeartbeatOutcome: async (options) => {
      calls.sent.push(options);
    },
  };
  const browser = async (_target, _password, result) => {
    if (browserError) throw new Error('unknown');
    Object.assign(result, evidence);
  };
  return { ...(await runHeartbeat(configured, env, helpers, browser, async () => {})), calls };
}

test('reuses helpers with exact scoped cleanup, SDK incident destination and separate receiver', async () => {
  const result = await exercise();
  assert.equal(result.passed, true);
  assert.equal(result.calls.cleaned[0].marker, configured.marker);
  assert.equal(result.calls.cleaned[0].prefix, undefined);
  assert.equal(result.calls.incidents[0].repo, 'bugdrophq/bugdrop-sdk-typescript');
  assert.equal(result.calls.sent[0].endpoint, 'https://bugdrop.dev/api/monitor/sdk-heartbeat');
  assert.deepEqual(Object.keys(result.report).sort(), [
    'observedAt',
    'outcome',
    'reasonCode',
    'schemaVersion',
  ]);
});
test('unknown delivery never resends or reports healthy, even when an issue exists', async () => {
  const result = await exercise({ browserError: true });
  assert.equal(result.passed, false);
  assert.equal(result.report.outcome, 'inconclusive');
  assert.equal(result.calls.cleaned.length, 0);
});
test('cleanup or incident failure prevents a green lifecycle result', async () => {
  for (const options of [{ cleanupError: true }, { incidentError: true }]) {
    const result = await exercise(options);
    assert.equal(result.passed, false);
    assert.equal(result.report.outcome, 'inconclusive');
  }
});
test('confirmed missing/duplicate issues remain delivery failures despite cleanup uncertainty', async () => {
  for (const issues of [[], [issue, issue]]) {
    const result = await exercise({ issues, cleanupError: true });
    assert.equal(result.passed, false);
    assert.equal(result.report.outcome, 'delivery_failed');
  }
});
test('leftover open canaries block new sends without broad cleanup', async () => {
  const result = await exercise({ existing: [issue] });
  assert.equal(result.passed, false);
  assert.equal(result.calls.cleaned.length, 0);
  assert.equal(result.report.outcome, 'inconclusive');
});
test('workflow is inert without an exact opt-in and never runs on PRs or forks', () => {
  const workflow = parse(
    readFileSync(new URL('../../.github/workflows/sdk-heartbeat.yml', import.meta.url), 'utf8')
  );
  assert.deepEqual(Object.keys(workflow.on).sort(), ['schedule', 'workflow_dispatch']);
  assert.deepEqual(workflow.permissions, {});
  assert.match(workflow.jobs.heartbeat.if, /BUGDROP_SDK_HEARTBEAT_MODE == 'daily'/);
  assert.match(workflow.jobs.heartbeat.if, /github.ref == 'refs\/heads\/main'/);
  assert.match(
    workflow.jobs.heartbeat.if,
    /github.repository == 'bugdrophq\/bugdrop-sdk-typescript'/
  );
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
});

// A transient final singleton is insufficient independent evidence for recovery.
test('poll exhaustion never verifies an unstable issue listing', async () => {
  for (const sequence of [
    [[], [], [], [], [], [issue]],
    [[], [issue], [], [issue], [], [issue]],
    [[issue], [], [], [], [], []],
  ]) {
    let calls = 0;
    const helpers = {
      listMatchingIssues: async (options) => (options.prefix ? [] : sequence[calls++]),
      closeMatchingIssues: async () => {},
      transitionHeartbeatIncident: async (options) => assert.notEqual(options.outcome, 'recovery'),
      sendHeartbeatOutcome: async (options) => assert.equal(options.report.outcome, 'inconclusive'),
    };
    const run = await runHeartbeat(
      configured,
      env,
      helpers,
      async (_target, _password, result) => Object.assign(result, evidence),
      async () => {}
    );
    assert.equal(run.passed, false);
    assert.equal(calls, 6);
  }
});

test('managed submission endpoint follows script origin, not a separate delivery override', () => {
  // bugdrophq/bugdrop@92dc85d8695d0c0be69af8110081ba9d48b0088a:
  // src/widget/managed/index.ts endpointFromScript; loader has no endpoint override.
  for (const origin of ['https://widget.bugdrop.dev', 'https://delivery.bugdrop.dev']) {
    const consistent = {
      ...target,
      widgetUrl: `${origin}/widget.v1.js`,
      submissionUrl: `${origin}/v1/submissions`,
    };
    assert.equal(
      readConfiguration({ ...env, BUGDROP_SDK_HEARTBEAT_TARGET: JSON.stringify(consistent) })
        .submissionUrl,
      consistent.submissionUrl
    );
    assert.throws(() =>
      readConfiguration({
        ...env,
        BUGDROP_SDK_HEARTBEAT_TARGET: JSON.stringify({
          ...consistent,
          submissionUrl: 'https://other.bugdrop.dev/v1/submissions',
        }),
      })
    );
  }
  assert.throws(() =>
    readConfiguration({
      ...env,
      BUGDROP_SDK_HEARTBEAT_TARGET: JSON.stringify({
        ...target,
        submissionUrl: 'https://delivery.bugdrop.dev/v1/submissions',
      }),
    })
  );
});

test('duplicates first visible during cleanup prevent recovery and remain confirmed failures', async () => {
  const result = await exercise({ cleanupMatches: [1, 2] });
  assert.equal(result.passed, false);
  assert.equal(result.report.outcome, 'delivery_failed');
  assert.equal(result.report.reasonCode, 'issue_duplicate');
  assert.equal(result.calls.incidents[0].outcome, 'failure');
});
test('cleanup must corroborate the same verified issue before a healthy result', async () => {
  const result = await exercise({ cleanupMatches: [2] });
  assert.equal(result.passed, false);
  assert.equal(result.report.outcome, 'inconclusive');
});
