import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { feedbackFor } from './verify.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const browserPhases = Object.freeze([
  'browser_launch',
  'fixture_sign_in',
  'fixture_identity',
  'widget_load',
  'submit_control',
  'capability_request',
  'submission_request',
  'delivery_receipt',
]);

export const receiptReasons = Object.freeze([
  'response_unreadable',
  'request_evidence_unverified',
  'unexpected_http_status',
  'unexpected_receipt_contract',
  'confirmation_unverified',
  'receipt_identity_unverified',
]);

export async function runBrowser(target, password, evidence, browserType = chromium) {
  const observePhase = (phase) => {
    // Route callbacks can complete after the page has moved on.
    if (browserPhases.indexOf(phase) > browserPhases.indexOf(evidence.browserPhase)) {
      evidence.browserPhase = phase;
    }
  };
  observePhase('browser_launch');
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    // No trace/video/HAR or persistent browser profile: these can contain credentials and capabilities.
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    let posts = 0;
    let authorizations = 0;
    let widgetMatched = false;
    let fixtureMatched = false;
    let violation = false;
    const feedback = feedbackFor(target);
    await context.route('**/*', async (route) => {
      try {
        const request = route.request();
        const url = request.url();
        const origin = new URL(url).origin;
        const allowed =
          origin === target.fixtureOrigin ||
          url === target.widgetUrl ||
          url === target.submissionUrl;
        if (!allowed) {
          violation = true;
          return route.abort();
        }
        if (url === `${target.fixtureOrigin}/fixture.js` || url === target.widgetUrl) {
          const response = await route.fetch({ maxRedirects: 0 });
          const bytes = await response.body();
          const expected =
            url === target.widgetUrl ? target.widgetSha256 : target.fixtureBundleSha256;
          if (response.status() !== 200 || sha256(bytes) !== expected) {
            violation = true;
            return route.abort();
          }
          if (url === target.widgetUrl) widgetMatched = true;
          else fixtureMatched = true;
          return route.fulfill({ response });
        }
        if (
          request.method() === 'POST' &&
          url === `${target.fixtureOrigin}/api/bugdrop-capability/v1`
        ) {
          observePhase('capability_request');
          authorizations++;
          if (authorizations !== 1) {
            violation = true;
            return route.abort();
          }
          const binding = request.postDataJSON();
          evidence.submissionId = binding.submissionId;
        }
        if (request.method() === 'POST' && url === target.submissionUrl) {
          observePhase('submission_request');
          posts++;
          const binding = request.headers()['x-bugdrop-submission-id'];
          if (
            posts !== 1 ||
            authorizations !== 1 ||
            binding !== evidence.submissionId ||
            JSON.stringify(request.postDataJSON()) !== JSON.stringify(feedback)
          ) {
            violation = true;
            return route.abort();
          }
          evidence.postValidated = true;
        }
        return route.continue();
      } catch {
        // Route callbacks are dispatched as events, outside the awaited page flow.
        // Abort locally so network/JSON/read errors become an inconclusive browser run.
        violation = true;
        await route.abort().catch(() => {});
      }
    });
    observePhase('fixture_sign_in');
    await page.goto(target.fixtureOrigin, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    observePhase('fixture_identity');
    const identityResponse = await page.request.get(`${target.fixtureOrigin}/heartbeat-identity`, {
      maxRedirects: 0,
    });
    const identity = await identityResponse.json();
    const expectedIdentity = {
      schemaVersion: 1,
      sdkCommit: target.sdkCommit,
      applicationId: target.applicationId,
      widgetUrl: target.widgetUrl,
      issuerUrl: target.issuerUrl,
      transport: 'public-https',
    };
    if (
      identityResponse.status() !== 200 ||
      !identity ||
      Object.keys(identity).sort().join() !== Object.keys(expectedIdentity).sort().join() ||
      Object.entries(expectedIdentity).some(([key, value]) => identity[key] !== value)
    )
      throw new Error('identity_failed');
    const open = page.getByRole('button', { name: 'Open BugDrop', exact: true });
    if (
      (await open.getAttribute('data-application')) !== target.applicationId ||
      (await open.getAttribute('data-widget')) !== target.widgetUrl
    )
      throw new Error('identity_failed');
    observePhase('widget_load');
    await open.click();
    await page.locator('input[name="title"]').fill(feedback.title);
    await page.locator('textarea[name="description"]').fill(feedback.description);
    await page.locator('select[name="category"]').selectOption('bug');
    observePhase('submit_control');
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url() === target.submissionUrl && response.request().method() === 'POST',
        { timeout: 100_000 }
      ),
      page.locator('[data-role="feedback"] button[type="submit"]').click(),
    ]);
    observePhase('delivery_receipt');
    evidence.receiptReason = 'response_unreadable';
    const outcome = await response.json();
    evidence.receiptReason = 'request_evidence_unverified';
    if (violation || !widgetMatched || !fixtureMatched || posts !== 1 || authorizations !== 1)
      return;
    evidence.receiptReason = 'unexpected_http_status';
    if (response.status() !== 200) return;
    evidence.receiptReason = 'unexpected_receipt_contract';
    if (outcome.schemaVersion !== 1 || outcome.status !== 'delivered') return;
    evidence.receiptReason = 'confirmation_unverified';
    await page.getByText('Feedback delivered.', { exact: true }).waitFor();
    evidence.receiptId = outcome.receiptId;
    evidence.receiptReason = 'receipt_identity_unverified';
  } finally {
    await browser.close();
  }
}
