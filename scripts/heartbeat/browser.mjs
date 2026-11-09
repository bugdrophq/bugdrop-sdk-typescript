import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { feedbackFor } from './verify.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function runBrowser(target, password, evidence, browserType = chromium) {
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
      const request = route.request();
      const url = request.url();
      const origin = new URL(url).origin;
      const allowed =
        origin === target.fixtureOrigin || url === target.widgetUrl || url === target.submissionUrl;
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
        authorizations++;
        if (authorizations !== 1) {
          violation = true;
          return route.abort();
        }
        const binding = request.postDataJSON();
        evidence.submissionId = binding.submissionId;
      }
      if (request.method() === 'POST' && url === target.submissionUrl) {
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
    });
    await page.goto(target.fixtureOrigin, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
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
    await open.click();
    await page.locator('input[name="title"]').fill(feedback.title);
    await page.locator('textarea[name="description"]').fill(feedback.description);
    await page.locator('select[name="category"]').selectOption('bug');
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url() === target.submissionUrl && response.request().method() === 'POST',
        { timeout: 100_000 }
      ),
      page.locator('[data-role="feedback"] button[type="submit"]').click(),
    ]);
    const outcome = await response.json();
    if (
      !violation &&
      widgetMatched &&
      fixtureMatched &&
      posts === 1 &&
      authorizations === 1 &&
      response.status() === 200 &&
      outcome.schemaVersion === 1 &&
      outcome.status === 'delivered'
    ) {
      await page.getByText('Feedback delivered.', { exact: true }).waitFor();
      evidence.receiptId = outcome.receiptId;
    }
  } finally {
    await browser.close();
  }
}
