// @vitest-environment jsdom

import { beforeEach, expect, it, vi } from 'vitest';

const options = {
  applicationId: 'app_presentation_fixture',
  tokenProvider: () => {
    throw new Error('Appearance cannot request a capability');
  },
  presentation: { accentColor: '#a1236f' },
};
const widgetApi = {
  open: vi.fn(),
  close: vi.fn(),
  hide: vi.fn(),
  show: vi.fn(),
  isOpen: () => false,
  isButtonVisible: () => true,
  setTheme: vi.fn(),
};

beforeEach(() => {
  vi.resetModules();
  document.head.replaceChildren();
  delete window.BugDrop;
});

it('only accepts a matching acknowledgment from the executing widget script', async () => {
  const { BugDrop } = await import('../packages/browser/src/index.js');
  const controller = BugDrop.init(options);
  const script = document.querySelector('script')!;
  const request = script.dataset.presentation;
  expect(JSON.parse(request!)).toEqual({ version: 1, options: options.presentation });
  const acknowledge = (detail: string | undefined, cancelable = true) =>
    script.dispatchEvent(new CustomEvent('bugdrop:presentation-ready', { detail, cancelable }));

  expect(acknowledge(request)).toBe(true);
  const currentScript = vi.spyOn(document, 'currentScript', 'get').mockReturnValue(script);
  try {
    expect(acknowledge('unsupported')).toBe(true);
    expect(acknowledge(request, false)).toBe(true);
    expect(acknowledge(request)).toBe(false);
    window.BugDrop = widgetApi;
    window.dispatchEvent(new CustomEvent('bugdrop:ready'));
  } finally {
    currentScript.mockRestore();
  }
  await controller.open();
  expect(widgetApi.open).toHaveBeenCalledOnce();
  expect(BugDrop.init(options)).toBe(controller);
  expect(() => BugDrop.init({ ...options, presentation: { accentColor: 'red' } })).toThrow(
    'different presentation configuration'
  );
});

it('rejects generic readiness without an acknowledgment and retires the provider', async () => {
  const { BugDrop } = await import('../packages/browser/src/index.js');
  const controller = BugDrop.init(options);
  const script = document.querySelector('script')!;
  const provider = script.dataset.authTokenProvider as `__bugdropSdkTokenProvider_${string}`;
  const currentScript = vi.spyOn(document, 'currentScript', 'get').mockReturnValue(script);
  try {
    window.dispatchEvent(new CustomEvent('bugdrop:ready'));
  } finally {
    currentScript.mockRestore();
  }
  script.dispatchEvent(new Event('load'));
  await expect(controller.ready).rejects.toThrow('requested presentation configuration');
  expect(script.isConnected).toBe(false);
  expect(window[provider]).toBeUndefined();
});

it('rejects invalid or oversized presentation containers before inserting a script', async () => {
  const { BugDrop } = await import('../packages/browser/src/index.js');
  expect(() => BugDrop.init({ ...options, presentation: [] } as unknown as typeof options)).toThrow(
    'presentation must be an object'
  );
  expect(() =>
    BugDrop.init({ ...options, presentation: { accentColor: 'a'.repeat(1024) } })
  ).toThrow('presentation configuration is too large');
  expect(document.querySelector('script')).toBeNull();
});

it('rejects a presentation with values JSON would silently omit', async () => {
  const { BugDrop } = await import('../packages/browser/src/index.js');
  const presentation = { accentColor: '#a1236f', unknownEffect: () => true };
  expect(() => BugDrop.init({ ...options, presentation })).toThrow(
    'presentation must contain serializable options'
  );
  expect(document.querySelector('script')).toBeNull();
});
