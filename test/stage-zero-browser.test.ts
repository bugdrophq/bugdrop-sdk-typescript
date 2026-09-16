// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import binding from '../packages/contracts/fixtures/submission-binding.v1.json';

describe('Stage 0 browser authority boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    document.head.innerHTML = '';
    delete window.BugDrop;
  });

  it.each([
    'apiKey',
    'authorization',
    'subject',
    'userId',
    'reporterId',
    'pseudonym',
    'tenantId',
    'repo',
    'repository',
    'installationId',
    'labels',
    'flow',
    'categoryLabels',
  ])('rejects %s before installing a script or invoking customer code', async (field) => {
    const { BugDrop } = await import('../packages/browser/src/index.js');
    const tokenProvider = vi.fn();
    expect(() =>
      BugDrop.init({ applicationId: 'app_public_123', tokenProvider, [field]: 'forbidden-canary' })
    ).toThrow('unsupported fields');
    expect(document.querySelector('script')).toBeNull();
    expect(tokenProvider).not.toHaveBeenCalled();
  });

  it('rejects identity-bearing bindings and provider failure without public fallback or leakage', async () => {
    const { BugDrop } = await import('../packages/browser/src/index.js');
    const tokenProvider = vi.fn().mockRejectedValue(new Error('secret-error-canary'));
    const controller = BugDrop.init({ applicationId: 'app_public_123', tokenProvider });
    const script = document.querySelector<HTMLScriptElement>('script')!;
    window.BugDrop = {
      open() {},
      close() {},
      hide() {},
      show() {},
      isOpen: () => false,
      isButtonVisible: () => true,
      setTheme() {},
    };
    script.dispatchEvent(new Event('load'));
    await controller.ready;
    const provider =
      window[script.dataset.authTokenProvider as `__bugdropSdkTokenProvider_${string}`]!;
    for (const field of ['subject', 'userId', 'reporterId', 'repo']) {
      await expect(provider({ ...binding.bound, [field]: 'forbidden-canary' })).rejects.toThrow(
        'Unable to authorize BugDrop'
      );
    }
    expect(tokenProvider).not.toHaveBeenCalled();
    await expect(provider(binding.bound)).rejects.toThrow(/^Unable to authorize BugDrop$/);
    expect(tokenProvider).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('script')).toHaveLength(1);
    expect(script.src).toBe('https://widget.bugdrop.dev/widget.v1.js');
    expect(document.documentElement.outerHTML).not.toMatch(/secret-error-canary|forbidden-canary/);
  });
});
