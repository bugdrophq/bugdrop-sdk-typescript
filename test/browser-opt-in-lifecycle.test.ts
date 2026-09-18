// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import binding from '../packages/contracts/fixtures/submission-binding.v1.json';

const widget = () => ({
  open: vi.fn(),
  close: vi.fn(),
  hide: vi.fn(),
  show: vi.fn(),
  isOpen: () => false,
  isButtonVisible: () => true,
  setTheme: vi.fn(),
});
const capability = () => ({
  schemaVersion: 1 as const,
  token: 'synthetic-token',
  expiresAt: new Date(Date.now() + 240_000).toISOString(),
});

beforeEach(() => {
  vi.resetModules();
  document.head.innerHTML = '';
  delete window.BugDrop;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each(['repo', 'authTokenProvider'])(
  'preserves pending direct %s installation (M1)',
  async (key) => {
    const direct = document.createElement('script');
    direct.dataset[key] = 'existing';
    document.head.appendChild(direct);
    const html = direct.outerHTML;
    const { BugDropOptIn } = await import('../packages/browser/src/opt-in.js');
    const provider = vi.fn();
    expect(() =>
      BugDropOptIn.init({ applicationId: 'app_test', tokenProviderWithMetadata: provider })
    ).toThrow('already installed');
    window.BugDrop = widget();
    window.dispatchEvent(new Event('bugdrop:ready'));
    expect(document.scripts).toHaveLength(1);
    expect(direct.outerHTML).toBe(html);
    expect(provider).not.toHaveBeenCalled();
  }
);

it('ignores unrelated ready events and captures only its own script API (M2)', async () => {
  const { BugDropOptIn } = await import('../packages/browser/src/opt-in.js');
  const controller = BugDropOptIn.init({
    applicationId: 'app_test',
    tokenProviderWithMetadata: vi.fn(),
  });
  const script = document.scripts[0]!;
  const foreign = widget();
  window.BugDrop = foreign;
  const ready = vi.fn();
  void controller.ready.then(ready);
  window.dispatchEvent(new Event('bugdrop:ready'));
  await Promise.resolve();
  await Promise.resolve();
  expect(ready).not.toHaveBeenCalled();
  const owned = widget();
  window.BugDrop = owned;
  vi.spyOn(document, 'currentScript', 'get').mockReturnValue(script);
  window.dispatchEvent(new Event('bugdrop:ready'));
  await controller.open();
  expect(owned.open).toHaveBeenCalledOnce();
  window.BugDrop = foreign;
  window.dispatchEvent(new Event('bugdrop:ready'));
  await controller.open();
  expect(foreign.open).not.toHaveBeenCalled();
  expect(owned.open).toHaveBeenCalledTimes(2);
});

it('blocks synchronous init reentry while appending the script', async () => {
  const { BugDropOptIn } = await import('../packages/browser/src/opt-in.js');
  const provider = vi.fn();
  const options = { applicationId: 'app_test', tokenProviderWithMetadata: provider };
  const append = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
    expect(() => BugDropOptIn.init(options)).toThrow('already initializing');
    return append(node);
  });
  const controller = BugDropOptIn.init(options);
  expect(document.scripts).toHaveLength(1);
  expect(provider).not.toHaveBeenCalled();
  window.BugDrop = widget();
  document.scripts[0]!.dispatchEvent(new Event('load'));
  await controller.ready;
});

it('retires a failed script provider and denies late success without second authorization', async () => {
  const { BugDropOptIn } = await import('../packages/browser/src/opt-in.js');
  let finish!: (value: ReturnType<typeof capability>) => void;
  const provider = vi.fn(
    () =>
      new Promise<ReturnType<typeof capability>>((resolve) => {
        finish = resolve;
      })
  );
  const controller = BugDropOptIn.init({
    applicationId: 'app_test',
    tokenProviderWithMetadata: provider,
  });
  const script = document.scripts[0]!;
  const callback =
    window[script.dataset.authTokenProvider as `__bugdropSdkTokenProvider_${string}`]!;
  const first = callback(binding.bound);
  script.dispatchEvent(new Event('error'));
  await expect(controller.ready).rejects.toThrow('Unable to load');
  finish(capability());
  await expect(first).rejects.toThrow('Unable to authorize');
  await expect(callback(binding.bound)).rejects.toThrow('Unable to authorize');
  expect(document.scripts).toHaveLength(0);
  expect(provider).toHaveBeenCalledOnce();
  const replacement = vi.fn().mockResolvedValue(capability());
  const retry = BugDropOptIn.init({
    applicationId: 'app_test',
    tokenProviderWithMetadata: replacement,
  });
  const nextScript = document.scripts[0]!;
  window.BugDrop = widget();
  nextScript.dispatchEvent(new Event('load'));
  await retry.ready;
  await expect(
    window[nextScript.dataset.authTokenProvider as `__bugdropSdkTokenProvider_${string}`]!(
      binding.bound
    )
  ).rejects.toThrow('Unable to authorize');
  expect(replacement).not.toHaveBeenCalled(); // A new loader cannot remint a spent report.
});

it('times out the owned script and removes its callback without fallback', async () => {
  vi.useFakeTimers();
  const { BugDropOptIn } = await import('../packages/browser/src/opt-in.js');
  const provider = vi.fn();
  const controller = BugDropOptIn.init({
    applicationId: 'app_test',
    tokenProviderWithMetadata: provider,
    loadTimeoutMs: 5,
  });
  const script = document.scripts[0]!;
  const name = script.dataset.authTokenProvider as `__bugdropSdkTokenProvider_${string}`;
  const rejected = expect(controller.ready).rejects.toThrow('Timed out');
  await vi.advanceTimersByTimeAsync(6);
  await rejected;
  expect(window[name]).toBeUndefined();
  expect(document.scripts).toHaveLength(0);
  expect(provider).not.toHaveBeenCalled();
});
