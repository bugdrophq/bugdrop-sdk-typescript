import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBrowser } from '../../scripts/heartbeat/browser.mjs';
import { feedbackFor } from '../../scripts/heartbeat/verify.mjs';

// Offline driver: a failed click closes the browser while its response waiter is pending.
// Node's test runner treats an unhandled waiter rejection as a test failure.
async function rejectDuringSubmit(lostResponse) {
  const target = {
    fixtureOrigin: 'https://sdk-heartbeat.example',
    applicationId: 'app_synthetic',
    sdkCommit: 'a'.repeat(40),
    widgetUrl: 'https://widget.bugdrop.dev/widget.v1.js',
    submissionUrl: 'https://widget.bugdrop.dev/v1/submissions',
    issuerUrl: 'https://managed.bugdrop.dev/v1/submission-capabilities',
    marker: 'test-run',
  };
  const submissionId = '00000000-0000-4000-8000-000000000002';
  const capabilityUrl = `${target.fixtureOrigin}/api/bugdrop-capability/v1`;
  const continued = [];
  const evidence = {};
  let handler;
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
  const locator = { fill: async () => {}, selectOption: async () => {}, click: async () => {} };
  const page = {
    setDefaultTimeout() {},
    goto: async () => {},
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
    getByRole: () => ({
      ...locator,
      getAttribute: async (name) =>
        name === 'data-application' ? target.applicationId : target.widgetUrl,
    }),
    locator: (selector) =>
      selector.includes('button[type')
        ? {
            click: async () => {
              if (!lostResponse) throw new Error('click failed');
              await send(capabilityUrl, { submissionId });
              await send(target.submissionUrl, feedbackFor(target));
              rejectResponse(new Error('response lost'));
            },
          }
        : locator,
    waitForResponse: () =>
      new Promise((_, reject) => {
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
  await assert.rejects(
    runBrowser(target, 'synthetic-password', evidence, browserType),
    lostResponse ? /response lost/ : /click failed/
  );
  await new Promise((resolve) => setImmediate(resolve));
  return { evidence, continued, expectedPosts: [capabilityUrl, target.submissionUrl] };
}

test('submit click failure does not leave an unhandled response waiter', async () => {
  const { evidence, continued } = await rejectDuringSubmit(false);
  assert.equal(evidence.browserPhase, 'submit_control');
  assert.deepEqual(continued, []);
});

test('a lost response preserves the last observed phase after exactly one validated submission', async () => {
  const { evidence, continued, expectedPosts } = await rejectDuringSubmit(true);
  assert.deepEqual(continued, expectedPosts);
  assert.equal(evidence.postValidated, true);
  assert.equal(evidence.browserPhase, 'submission_request');
  assert.equal(evidence.receiptId, undefined);
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
