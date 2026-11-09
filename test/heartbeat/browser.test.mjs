import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBrowser } from '../../scripts/heartbeat/browser.mjs';

// Offline driver: a failed click closes the browser while its response waiter is pending.
// Node's test runner treats an unhandled waiter rejection as a test failure.
test('submit click failure does not leave an unhandled response waiter', async () => {
  const target = {
    fixtureOrigin: 'https://sdk-heartbeat.example',
    applicationId: 'app_synthetic',
    sdkCommit: 'a'.repeat(40),
    widgetUrl: 'https://widget.bugdrop.dev/widget.v1.js',
    issuerUrl: 'https://managed.bugdrop.dev/v1/submission-capabilities',
  };
  let rejectResponse;
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
              throw new Error('click failed');
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
      newContext: async () => ({ newPage: async () => page, route: async () => {} }),
      close: async () => {
        rejectResponse?.(new Error('Browser closed'));
      },
    }),
  };
  await assert.rejects(runBrowser(target, 'synthetic-password', {}, browserType), /click failed/);
  await new Promise((resolve) => setImmediate(resolve));
});
