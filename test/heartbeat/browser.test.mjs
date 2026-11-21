import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runBrowser } from '../../scripts/heartbeat/browser.mjs';
import { feedbackFor } from '../../scripts/heartbeat/verify.mjs';

const delivered = {
  schemaVersion: 1,
  status: 'delivered',
  receiptId: '00000000-0000-4000-8000-000000000001',
};

async function exerciseSubmission({
  clickFails = false,
  responseLost = false,
  skipWidget = false,
  status = 200,
  outcome = delivered,
  jsonFails = false,
  confirmationFails = false,
  expectedError,
} = {}) {
  const script = Buffer.from('synthetic script');
  const scriptHash = createHash('sha256').update(script).digest('hex');
  const target = {
    fixtureOrigin: 'https://sdk-heartbeat.example',
    applicationId: 'app_synthetic',
    sdkCommit: 'a'.repeat(40),
    widgetUrl: 'https://widget.bugdrop.dev/widget.v1.js',
    submissionUrl: 'https://widget.bugdrop.dev/v1/submissions',
    issuerUrl: 'https://managed.bugdrop.dev/v1/submission-capabilities',
    marker: 'test-run',
    widgetSha256: scriptHash,
    fixtureBundleSha256: scriptHash,
  };
  const submissionId = '00000000-0000-4000-8000-000000000002';
  const capabilityUrl = `${target.fixtureOrigin}/api/bugdrop-capability/v1`;
  const continued = [];
  const evidence = {};
  let confirmationAttempts = 0;
  let handler;
  let resolveResponse;
  let rejectResponse;
  const send = (url, body) =>
    handler({
      request: () => ({
        url: () => url,
        method: () => 'POST',
        headers: () => ({ 'x-bugdrop-submission-id': submissionId }),
        postDataJSON: () => body,
      }),
      abort: async () => assert.fail('valid synthetic POST was blocked'),
      continue: async () => continued.push(url),
    });
  const loadScript = (url) =>
    handler({
      request: () => ({ url: () => url }),
      fetch: async () => ({ status: () => 200, body: async () => script }),
      fulfill: async () => {},
      abort: async () => assert.fail('valid fixture script was blocked'),
    });
  const locator = { fill: async () => {}, selectOption: async () => {}, click: async () => {} };
  const page = {
    setDefaultTimeout() {},
    goto: async () => loadScript(`${target.fixtureOrigin}/fixture.js`),
    request: {
      get: async () => ({
        status: () => 200,
        json: async () => ({
          schemaVersion: 1,
          sdkCommit: target.sdkCommit,
          applicationId: target.applicationId,
          widgetUrl: target.widgetUrl,
          issuerUrl: target.issuerUrl,
          transport: 'public-https',
        }),
      }),
    },
    getByLabel: () => locator,
    getByRole: (_role, { name }) => ({
      ...locator,
      click: async () => {
        if (name === 'Open BugDrop' && !skipWidget) await loadScript(target.widgetUrl);
      },
      getAttribute: async (name) =>
        name === 'data-application' ? target.applicationId : target.widgetUrl,
    }),
    getByText: (text, options) => {
      assert.equal(text, 'Feedback delivered.');
      assert.deepEqual(options, { exact: true });
      return {
        waitFor: async () => {
          confirmationAttempts++;
          if (confirmationFails) throw new Error('confirmation unavailable');
        },
      };
    },
    locator: (selector) =>
      selector.includes('button[type')
        ? {
            click: async () => {
              if (clickFails) throw new Error('click failed');
              await send(capabilityUrl, { submissionId });
              await send(target.submissionUrl, feedbackFor(target));
              if (responseLost) {
                rejectResponse(new Error('response lost'));
                return;
              }
              resolveResponse({
                status: () => status,
                json: async () => {
                  if (jsonFails) throw new Error('unreadable synthetic response');
                  return outcome;
                },
              });
            },
          }
        : locator,
    waitForResponse: () =>
      new Promise((resolve, reject) => {
        resolveResponse = resolve;
        rejectResponse = reject;
      }),
  };
  const browserType = {
    launch: async () => ({
      newContext: async () => ({
        newPage: async () => page,
        route: async (_pattern, callback) => {
          handler = callback;
        },
      }),
      close: async () => {
        rejectResponse?.(new Error('Browser closed'));
      },
    }),
  };
  const run = runBrowser(target, 'synthetic-password', evidence, browserType);
  if (expectedError) await assert.rejects(run, expectedError);
  else await run;
  await new Promise((resolve) => setImmediate(resolve));
  return {
    evidence,
    continued,
    confirmationAttempts,
    expectedPosts: [capabilityUrl, target.submissionUrl],
  };
}

test('submit click failure does not leave an unhandled response waiter', async () => {
  const { evidence, continued } = await exerciseSubmission({
    clickFails: true,
    expectedError: /click failed/,
  });
  assert.equal(evidence.browserPhase, 'submit_control');
  assert.deepEqual(continued, []);
});

test('a lost response preserves the last observed phase after exactly one validated submission', async () => {
  const { evidence, continued, expectedPosts } = await exerciseSubmission({
    responseLost: true,
    expectedError: /response lost/,
  });
  assert.deepEqual(continued, expectedPosts);
  assert.equal(evidence.postValidated, true);
  assert.equal(evidence.browserPhase, 'submission_request');
  assert.equal(evidence.receiptId, undefined);
});

for (const [reason, options, confirmationAttempts] of [
  ['response_unreadable', { jsonFails: true, expectedError: /unreadable synthetic response/ }, 0],
  ['request_evidence_unverified', { skipWidget: true }, 0],
  ['unexpected_http_status', { status: 503 }, 0],
  ['unexpected_receipt_contract', { outcome: { ...delivered, schemaVersion: 2 } }, 0],
  [
    'confirmation_unverified',
    { confirmationFails: true, expectedError: /confirmation unavailable/ },
    1,
  ],
]) {
  test(`receipt processing records ${reason} and preserves one validated submission`, async () => {
    const result = await exerciseSubmission(options);
    assert.deepEqual(result.continued, result.expectedPosts);
    assert.equal(result.evidence.postValidated, true);
    assert.equal(result.evidence.browserPhase, 'delivery_receipt');
    assert.equal(result.evidence.receiptReason, reason);
    assert.equal(result.evidence.receiptId, undefined);
    assert.equal(result.confirmationAttempts, confirmationAttempts);
  });
}

test('a delivered response still requires visible confirmation before retaining its receipt ID', async () => {
  const result = await exerciseSubmission();
  assert.deepEqual(result.continued, result.expectedPosts);
  assert.equal(result.confirmationAttempts, 1);
  assert.equal(result.evidence.receiptId, delivered.receiptId);
  assert.equal(result.evidence.receiptReason, 'receipt_identity_unverified');
});

test('script-fetch rejection is caught inside the event-driven route handler', async () => {
  let handler;
  let aborted = false;
  const target = { fixtureOrigin: 'https://sdk-heartbeat.example' };
  const route = {
    request: () => ({ url: () => `${target.fixtureOrigin}/fixture.js` }),
    fetch: async () => {
      throw new Error('Connection reset');
    },
    abort: async () => {
      aborted = true;
    },
  };
  const page = {
    setDefaultTimeout() {},
    goto: async () => {
      // Like Playwright's dispatcher, this task is independent of the awaited navigation.
      void handler(route);
      await new Promise((resolve) => setImmediate(resolve));
      throw new Error('Navigation aborted');
    },
  };
  const browserType = {
    launch: async () => ({
      newContext: async () => ({
        newPage: async () => page,
        route: async (_pattern, callback) => {
          handler = callback;
        },
      }),
      close: async () => {},
    }),
  };
  const evidence = {};
  await assert.rejects(
    runBrowser(target, 'synthetic-password', evidence, browserType),
    /Navigation aborted/
  );
  assert.equal(aborted, true);
  assert.equal(evidence.browserPhase, 'fixture_sign_in');
});
