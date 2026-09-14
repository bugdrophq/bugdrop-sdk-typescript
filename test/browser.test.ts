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
    await controller.close();
    await controller.hide();
    await controller.show();
    await controller.setTheme('light');
    await expect(controller.isOpen()).resolves.toBe(false);
    await expect(controller.isButtonVisible()).resolves.toBe(true);
    expect(calls).toEqual(['open', 'close', 'hide', 'show', 'setTheme:light']);

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

describe('@bugdrop/browser failure handling', () => {
  beforeEach(() => {
    vi.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete window.BugDrop;
  });

  it('fails closed when the hosted script errors', async () => {
    const { BugDrop } = await import('../packages/browser/src/index.js');
    const controller = BugDrop.init({
      applicationId: 'app_public_123',
      tokenProvider: async () => capability,
    });
    const script = document.querySelector<HTMLScriptElement>('script')!;
    const providerName = script.dataset.authTokenProvider as `__bugdropSdkTokenProvider_${string}`;
    script.dispatchEvent(new Event('error'));
    await expect(controller.ready).rejects.toThrow('Unable to load');
    expect(document.querySelector('script')).toBeNull();
    expect(window[providerName]).toBeUndefined();
  });

  it('rejects an incompatible hosted widget API', async () => {
    const { BugDrop } = await import('../packages/browser/src/index.js');
    const controller = BugDrop.init({
      applicationId: 'app_public_123',
      tokenProvider: async () => capability,
    });
    document.querySelector<HTMLScriptElement>('script')!.dispatchEvent(new Event('load'));
    await expect(controller.ready).rejects.toThrow('compatible API');
  });

  it('accepts the load event when the widget exposes the complete API', async () => {
    const { BugDrop } = await import('../packages/browser/src/index.js');
    const controller = BugDrop.init({
      applicationId: 'app_public_123',
      tokenProvider: async () => capability,
    });
    window.BugDrop = createWidgetApi([]);
    document.querySelector<HTMLScriptElement>('script')!.dispatchEvent(new Event('load'));
    await expect(controller.ready).resolves.toBeUndefined();
  });

  it('reuses one Application controller and rejects a different Application', async () => {
    const { BugDrop } = await import('../packages/browser/src/index.js');
    const options = {
      applicationId: 'app_public_123',
      tokenProvider: async () => capability,
    };
    const controller = BugDrop.init(options);
    expect(BugDrop.init(options)).toBe(controller);
    expect(() => BugDrop.init({ ...options, applicationId: 'app_public_other' })).toThrow(
      'another Application'
    );
  });

  it.each([
    [{ applicationId: ' ', tokenProvider: async () => capability }, 'Application ID'],
    [{ applicationId: 'app_public_123', tokenProvider: true }, 'token provider'],
    [
      { applicationId: 'app_public_123', tokenProvider: async () => capability, theme: 'sepia' },
      'theme',
    ],
    [
      { applicationId: 'app_public_123', tokenProvider: async () => capability, position: 'top' },
      'position',
    ],
    [
      { applicationId: 'app_public_123', tokenProvider: async () => capability, button: 'yes' },
      'button',
    ],
    [
      { applicationId: 'app_public_123', tokenProvider: async () => capability, loadTimeoutMs: 0 },
      'loadTimeoutMs',
    ],
  ])('rejects invalid runtime options %#', async (options, message) => {
    const { BugDrop } = await import('../packages/browser/src/index.js');
    expect(() => BugDrop.init(options as never)).toThrow(message as string);
    expect(document.querySelector('script')).toBeNull();
  });

  it.each(['not a URL', 'http://example.com/widget.js', 'https://user:pass@example.com/widget.js'])(
    'rejects unsafe widget URL %s',
    async (widgetUrl) => {
      const { BugDrop } = await import('../packages/browser/src/index.js');
      expect(() =>
        BugDrop.init({
          applicationId: 'app_public_123',
          tokenProvider: async () => capability,
          widgetUrl,
        })
      ).toThrow(/valid URL|HTTPS/);
    }
  );

  it('redacts malformed and overlong capability details', async () => {
    const secretToken = 'capability-that-must-not-leak';
    const { BugDrop } = await import('../packages/browser/src/index.js');
    const controller = BugDrop.init({
      applicationId: 'app_public_123',
      tokenProvider: async () => ({
        schemaVersion: 1,
        token: secretToken,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    });
    const script = document.querySelector<HTMLScriptElement>('script')!;
    window.BugDrop = createWidgetApi([]);
    window.dispatchEvent(new CustomEvent('bugdrop:ready'));
    await controller.ready;
    const provider =
      window[script.dataset.authTokenProvider as `__bugdropSdkTokenProvider_${string}`];
    await expect(provider!()).rejects.toThrow('Unable to authorize BugDrop');
    await expect(provider!()).rejects.not.toThrow(secretToken);
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
