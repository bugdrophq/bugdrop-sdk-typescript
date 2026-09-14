// @vitest-environment jsdom

import widgetApiFixture from '../packages/contracts/fixtures/widget-public-api.v1.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const capability = {
  schemaVersion: 1 as const,
  token: 'short-lived-opaque-capability',
  expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
};

describe('@bugdrop/browser', () => {
  beforeEach(() => {
    vi.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    delete window.BugDrop;
  });

  it('loads and controls the authoritative hosted widget without privileged browser inputs', async () => {
    const tokenProvider = vi.fn().mockResolvedValue(capability);
    const { BugDrop } = await import('../packages/browser/src/index.js');
    const controller = BugDrop.init({
      applicationId: 'app_public_123',
      tokenProvider,
      theme: 'dark',
    });

    const script = document.querySelector<HTMLScriptElement>('script');
    expect(script).not.toBeNull();
    expect(script!.src).toBe('https://bugdrop.neonwatty.workers.dev/widget.v1.js');
    expect(script!.dataset.applicationId).toBe('app_public_123');
    expect(script!.dataset.contractVersion).toBe('1');
    expect(script!.dataset.repo).toBeUndefined();
    expect(script!.dataset.categoryLabels).toBeUndefined();
    expect(script!.dataset.flow).toBeUndefined();
    expect(tokenProvider).not.toHaveBeenCalled();

    const calls: string[] = [];
    window.BugDrop = createWidgetApi(calls);
    window.dispatchEvent(new CustomEvent('bugdrop:ready'));
    await controller.open();
    await controller.setTheme('light');
    expect(calls).toEqual(['open', 'setTheme:light']);

    const providerName = script!.dataset.authTokenProvider!;
    const installedProvider = window[providerName as `__bugdropSdkTokenProvider_${string}`];
    expect(await installedProvider!()).toBe(capability.token);
    expect(tokenProvider).toHaveBeenCalledOnce();
    expect(document.documentElement.outerHTML).not.toContain(capability.token);
    expect(JSON.stringify(localStorage)).not.toContain(capability.token);
    expect(JSON.stringify(sessionStorage)).not.toContain(capability.token);
  });

  it('tracks the versioned public widget controller fixture', () => {
    const api = createWidgetApi([]) as unknown as Record<string, unknown>;
    expect(widgetApiFixture.methods.every((method) => typeof api[method] === 'function')).toBe(
      true
    );
  });

  it('rejects expired capabilities without revealing the token', async () => {
    const expired = {
      ...capability,
      token: 'must-never-leak',
      expiresAt: '2020-01-01T00:00:00.000Z',
    };
    const { BugDrop } = await import('../packages/browser/src/index.js');
    const controller = BugDrop.init({
      applicationId: 'app_public_123',
      tokenProvider: async () => expired,
    });
    const script = document.querySelector<HTMLScriptElement>('script')!;
    window.BugDrop = createWidgetApi([]);
    window.dispatchEvent(new CustomEvent('bugdrop:ready'));
    await controller.ready;
    const provider =
      window[script.dataset.authTokenProvider as `__bugdropSdkTokenProvider_${string}`];
    await expect(provider!()).rejects.toThrow('Unable to authorize BugDrop');
    await expect(provider!()).rejects.not.toThrow('must-never-leak');
  });

  it('rejects server-only and privileged configuration fields', async () => {
    const { BugDrop } = await import('../packages/browser/src/index.js');
    expect(() =>
      BugDrop.init({
        applicationId: 'app_public_123',
        tokenProvider: async () => capability,
        ...({ secretKey: 'must-not-enter-browser-config' } as Record<string, unknown>),
      })
    ).toThrow('unsupported fields');
    expect(document.querySelector('script')).toBeNull();
  });

  it('does not attach to a pre-existing legacy widget', async () => {
    window.BugDrop = createWidgetApi([]);
    const { BugDrop } = await import('../packages/browser/src/index.js');
    expect(() =>
      BugDrop.init({
        applicationId: 'app_public_123',
        tokenProvider: async () => capability,
      })
    ).toThrow('already installed');
    expect(document.querySelector('script')).toBeNull();
  });
});

function createWidgetApi(calls: string[]) {
  return {
    open: () => calls.push('open'),
    close: () => calls.push('close'),
    hide: () => calls.push('hide'),
    show: () => calls.push('show'),
    isOpen: () => false,
    isButtonVisible: () => true,
    setTheme: (theme: string) => calls.push(`setTheme:${theme}`),
  };
}
