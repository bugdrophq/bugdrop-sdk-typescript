// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  delete window.BugDrop;
});
afterEach(() => vi.restoreAllMocks());

function widget() {
  return {
    open: vi.fn(),
    close: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
    isOpen: () => false,
    isButtonVisible: () => true,
    setTheme: vi.fn(),
  };
}

it.each(['repo', 'authTokenProvider'])(
  'leaves a pending direct %s installation untouched instead of adopting its ready event',
  async (field) => {
    const original = document.createElement('script');
    original.src = 'https://customer.example.test/custom-feedback.js';
    original.dataset[field] = field === 'repo' ? 'owner/repo' : 'existingProvider';
    document.head.appendChild(original);
    const html = original.outerHTML;
    const globals = Object.keys(window).filter((key) =>
      key.startsWith('__bugdropSdkTokenProvider_')
    );
    const { BugDrop } = await import('../packages/browser/src/index.js');
    const tokenProvider = vi.fn();
    expect(original.outerHTML).toBe(html);
    expect(document.scripts).toHaveLength(1);
    expect(() => BugDrop.init({ applicationId: 'app_manual', tokenProvider })).toThrow(
      'already installed'
    );
    const current = widget();
    window.BugDrop = current;
    window.dispatchEvent(new CustomEvent('bugdrop:ready'));
    expect(document.scripts).toHaveLength(1);
    expect(original.outerHTML).toBe(html);
    expect(window.BugDrop).toBe(current);
    expect(tokenProvider).not.toHaveBeenCalled();
    expect(current.open).not.toHaveBeenCalled();
    expect(
      Object.keys(window).filter((key) => key.startsWith('__bugdropSdkTokenProvider_'))
    ).toEqual(globals);
  }
);

it('ignores another script ready event before the managed script loads', async () => {
  const unrelated = document.createElement('script');
  unrelated.src = 'https://customer.example.test/analytics.js';
  document.head.appendChild(unrelated);
  const { BugDrop } = await import('../packages/browser/src/index.js');
  const tokenProvider = vi.fn();
  const controller = BugDrop.init({ applicationId: 'app_manual', tokenProvider });
  const managed = document.scripts[1]!;
  const oldWidget = widget();
  window.BugDrop = oldWidget;
  const ready = vi.fn();
  void controller.ready.then(ready);
  window.dispatchEvent(new CustomEvent('bugdrop:ready'));
  await Promise.resolve();
  await Promise.resolve();
  expect(ready).not.toHaveBeenCalled();
  expect(tokenProvider).not.toHaveBeenCalled();
  const managedWidget = widget();
  window.BugDrop = managedWidget;
  managed.dispatchEvent(new Event('load'));
  await controller.open();
  expect(managedWidget.open).toHaveBeenCalledOnce();
  expect(oldWidget.open).not.toHaveBeenCalled();
  // Later globals/events cannot change the controller captured from the managed installation.
  window.BugDrop = oldWidget;
  window.dispatchEvent(new CustomEvent('bugdrop:ready'));
  await controller.open();
  expect(managedWidget.open).toHaveBeenCalledTimes(2);
  expect(oldWidget.open).not.toHaveBeenCalled();
});

it('accepts readiness emitted while its own script executes, after ignoring an unrelated event', async () => {
  const { BugDrop } = await import('../packages/browser/src/index.js');
  const controller = BugDrop.init({ applicationId: 'app_manual', tokenProvider: vi.fn() });
  window.dispatchEvent(new CustomEvent('bugdrop:ready'));
  const managed = document.scripts[0]!;
  const current = widget();
  window.BugDrop = current;
  vi.spyOn(document, 'currentScript', 'get').mockReturnValue(managed);
  window.dispatchEvent(new CustomEvent('bugdrop:ready'));
  await controller.open();
  expect(current.open).toHaveBeenCalledOnce();
});
