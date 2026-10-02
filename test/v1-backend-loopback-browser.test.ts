import { webcrypto } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error jsdom does not provide bundled TypeScript declarations.
import { JSDOM } from 'jsdom';
import { startLoopback } from '../examples/v1-backend/loopback-server.js';
import { installLocalWidget } from '../examples/v1-backend/loopback-widget.js';

type Fixture = Awaited<ReturnType<typeof startLoopback>>;
const fixtures: Fixture[] = [];
const directories: string[] = [];
const nativeFetch = globalThis.fetch;

async function start() {
  const directory = await mkdtemp(join(tmpdir(), 'bugdrop-v1-browser-'));
  directories.push(directory);
  const fixture = await startLoopback(directory, '/* browser bundle */', '/* widget double */');
  fixtures.push(fixture);
  return fixture;
}

async function page(fixture: Fixture, csrfOverride?: string) {
  const response = await nativeFetch(fixture.origin);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  const html = await response.text();
  expect(cookie).toMatch(/^bd_loopback_session=[a-f0-9]{64}$/);
  const dom = new JSDOM(html, { url: fixture.origin, runScripts: 'outside-only' });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('location', dom.window.location);
  vi.stubGlobal('sessionStorage', dom.window.sessionStorage);
  vi.stubGlobal('HTMLScriptElement', dom.window.HTMLScriptElement);
  vi.stubGlobal('CustomEvent', dom.window.CustomEvent);
  vi.stubGlobal('crypto', webcrypto);
  if (csrfOverride)
    document.querySelector<HTMLButtonElement>('#exchange')!.dataset.csrf = csrfOverride;
  const browserFetch = vi.fn<typeof fetch>(async (target, init) => {
    // Browser and customer server run in different runtimes; the test shares one process.
    const browserWindow = globalThis.window;
    const browserDocument = globalThis.document;
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');
    try {
      return await nativeFetch(target, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string>),
          Origin: fixture.origin,
          Cookie: cookie!,
        },
      });
    } finally {
      vi.stubGlobal('window', browserWindow);
      vi.stubGlobal('document', browserDocument);
    }
  });
  vi.stubGlobal('fetch', browserFetch);
  vi.resetModules();
  vi.doMock('@bugdrop/browser', async () => import('../packages/browser/src/index.js'));
  await import('../examples/v1-backend/loopback-browser.js');
  const script = document.querySelector<HTMLScriptElement>('script[data-auth-token-provider]')!;
  expect(script.src).toBe(`${fixture.origin}/local-widget.js`);
  return {
    browserFetch,
    button: document.querySelector<HTMLButtonElement>('#exchange')!,
    script,
    dom,
  };
}

async function click(button: HTMLButtonElement) {
  const complete = new Promise<void>((resolve) =>
    window.addEventListener('bugdrop:local-result', () => resolve(), { once: true })
  );
  button.click();
  await complete;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('local widget handoff through the real browser loader', () => {
  it('uses the registered hook and makes one customer route and issuer exchange per click', async () => {
    const fixture = await start();
    const { browserFetch, button, script, dom } = await page(fixture);
    expect(button.disabled).toBe(true);
    expect(fixture.exchanges()).toBe(0);
    installLocalWidget(script);
    script.dispatchEvent(new dom.window.Event('load'));
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    await click(button);
    expect(document.querySelector('#result')?.textContent).toBe(
      'Local capability received. No submission sent.'
    );
    expect(browserFetch).toHaveBeenCalledOnce();
    expect(fixture.exchanges()).toBe(1);
    expect(JSON.stringify(browserFetch.mock.calls)).not.toContain('bd_api_v1');
    expect(document.documentElement.outerHTML).not.toContain('local-fixture-');
    expect(sessionStorage.getItem('bugdrop-v1-pending-binding')).toBeNull();
  });

  it('keeps the exact binding after a lost reply and retries only on another click', async () => {
    const fixture = await start();
    const { browserFetch, button, script, dom } = await page(fixture);
    installLocalWidget(script);
    script.dispatchEvent(new dom.window.Event('load'));
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    const firstFetch = browserFetch.getMockImplementation()!;
    browserFetch.mockImplementationOnce(async (target, init) => {
      await firstFetch(target, init);
      return new Response(null, { status: 502 });
    });
    await click(button);
    expect(document.querySelector('#result')?.textContent).toBe('Unable to authorize BugDrop');
    const pending = sessionStorage.getItem('bugdrop-v1-pending-binding');
    expect(pending).not.toBeNull();
    expect(fixture.exchanges()).toBe(1);
    await Promise.resolve();
    expect(fixture.exchanges()).toBe(1);
    await click(button);
    expect(browserFetch).toHaveBeenCalledTimes(2);
    expect(fixture.exchanges()).toBe(2);
    const requests = browserFetch.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(requests).toEqual([JSON.parse(pending!), JSON.parse(pending!)]);
    expect(sessionStorage.getItem('bugdrop-v1-pending-binding')).toBeNull();
  });

  it('denies a bad CSRF token before the local issuer and does not retry automatically', async () => {
    const fixture = await start();
    const { browserFetch, button, script, dom } = await page(fixture, '0'.repeat(64));
    installLocalWidget(script);
    script.dispatchEvent(new dom.window.Event('load'));
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    await click(button);
    expect(document.querySelector('#result')?.textContent).toBe('Unable to authorize BugDrop');
    expect(browserFetch).toHaveBeenCalledOnce();
    expect(fixture.exchanges()).toBe(0);
    expect(sessionStorage.getItem('bugdrop-v1-pending-binding')).not.toBeNull();
    await Promise.resolve();
    expect(browserFetch).toHaveBeenCalledOnce();
  });

  it('rejects a changed pending digest before another route or issuer call', async () => {
    const fixture = await start();
    const { browserFetch, button, script, dom } = await page(fixture);
    installLocalWidget(script);
    script.dispatchEvent(new dom.window.Event('load'));
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    await click(button);
    const bound = JSON.parse(String(browserFetch.mock.calls[0]?.[1]?.body)) as {
      submissionId: string;
      payloadDigest: string;
    };
    sessionStorage.setItem(
      'bugdrop-v1-pending-binding',
      JSON.stringify({ ...bound, payloadDigest: 'A'.repeat(43) })
    );
    await click(button);
    expect(document.querySelector('#result')?.textContent).toBe('Unable to authorize BugDrop');
    expect(browserFetch).toHaveBeenCalledTimes(1);
    expect(fixture.exchanges()).toBe(1);
  });

  it('keeps corrupted pending storage closed instead of generating a new submission ID', async () => {
    const fixture = await start();
    const { browserFetch, button, script, dom } = await page(fixture);
    sessionStorage.setItem('bugdrop-v1-pending-binding', '{broken');
    installLocalWidget(script);
    script.dispatchEvent(new dom.window.Event('load'));
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    await click(button);
    expect(document.querySelector('#result')?.textContent).toBe('Unable to authorize BugDrop');
    expect(sessionStorage.getItem('bugdrop-v1-pending-binding')).toBe('{broken');
    expect(browserFetch).not.toHaveBeenCalled();
    expect(fixture.exchanges()).toBe(0);
  });

  it('does not request a capability when the local widget fails to load', async () => {
    const fixture = await start();
    const { browserFetch, button, script, dom } = await page(fixture);
    script.dispatchEvent(new dom.window.Event('error'));
    await vi.waitFor(() =>
      expect(document.querySelector('#result')?.textContent).toBe(
        'Unable to load local widget double'
      )
    );
    expect(button.disabled).toBe(true);
    expect(browserFetch).not.toHaveBeenCalled();
    expect(fixture.exchanges()).toBe(0);
  });
});
