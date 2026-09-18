// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import browserPackage from '../packages/browser/package.json';
import fixture from '../packages/contracts/fixtures/submission-binding.v1.json';
import type { SubmissionBinding } from '../packages/contracts/src/index.js';

const binding = fixture.bound;
const capability = () => ({
  schemaVersion: 1 as const,
  token: 'synthetic-token',
  expiresAt: new Date(Date.now() + 240_000).toISOString(),
});
const widget = () => ({
  open: vi.fn(),
  close: vi.fn(),
  hide: vi.fn(),
  show: vi.fn(),
  isOpen: () => false,
  isButtonVisible: () => true,
  setTheme: vi.fn(),
});

beforeEach(() => {
  vi.resetModules();
  document.head.innerHTML = '';
  delete window.BugDrop;
  for (const key of Object.keys(window)) {
    if (key.startsWith('__bugdropSdkTokenProvider_'))
      delete window[key as `__bugdropSdkTokenProvider_${string}`];
  }
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

async function setup(provider = vi.fn().mockResolvedValue(capability())) {
  const { BugDropOptIn } = await import('../packages/browser/src/opt-in.js');
  const controller = BugDropOptIn.init({
    applicationId: 'app_test',
    tokenProviderWithMetadata: provider,
  });
  const script = document.scripts[0]!;
  const api = widget();
  window.BugDrop = api;
  script.dispatchEvent(new Event('load'));
  await controller.ready;
  const callback =
    window[script.dataset.authTokenProvider as `__bugdropSdkTokenProvider_${string}`]!;
  return { BugDropOptIn, controller, script, api, callback, provider };
}

it('passes unchanged binding and fresh frozen installed-browser metadata, separate from server claims', async () => {
  const serverClaim = '999.888.777';
  const state = await setup();
  const next = { ...binding, submissionId: '22222222-2222-4222-8222-222222222222' };
  await expect(state.callback(binding)).resolves.toBe('synthetic-token');
  await expect(state.callback(next)).resolves.toBe('synthetic-token');
  const first = state.provider.mock.calls[0]!;
  const second = state.provider.mock.calls[1]!;
  expect(first).toHaveLength(2);
  expect(first[0]).toEqual(binding);
  expect(Object.keys(first[0])).toEqual(['submissionId', 'payloadDigest']);
  expect(first[1]).toEqual({ metadataVersion: 1, browserSdkVersion: browserPackage.version });
  expect(first[1].browserSdkVersion).not.toBe(serverClaim);
  expect(Object.isFrozen(first[1])).toBe(true);
  expect(second[1]).not.toBe(first[1]);
  expect(second[1]).toEqual(first[1]);
  expect(Reflect.set(first[1], 'browserSdkVersion', serverClaim)).toBe(false);
  expect(state.script.dataset.contractVersion).toBe('1'); // Hosted callback binding stays V1.
  expect(state.script.dataset.sdkVersion).toBe(browserPackage.version);
  expect(document.documentElement.outerHTML).not.toMatch(/synthetic-token|999\.888\.777/);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

it('keeps the imported version and original callback even if caller mutates its options', async () => {
  const { BugDropOptIn } = await import('../packages/browser/src/opt-in.js');
  const original = vi.fn().mockResolvedValue(capability());
  const replacement = vi.fn();
  const options = { applicationId: 'app_test', tokenProviderWithMetadata: original };
  const controller = BugDropOptIn.init(options);
  options.tokenProviderWithMetadata = replacement;
  const script = document.scripts[0]!;
  window.BugDrop = widget();
  script.dispatchEvent(new Event('load'));
  await controller.ready;
  await window[script.dataset.authTokenProvider as `__bugdropSdkTokenProvider_${string}`]!(binding);
  expect(original).toHaveBeenCalledOnce();
  expect(replacement).not.toHaveBeenCalled();
});

it('preserves the classic single-argument callback without metadata', async () => {
  const { BugDrop } = await import('../packages/browser/src/index.js');
  const provider = vi.fn().mockResolvedValue(capability());
  const controller = BugDrop.init({ applicationId: 'app_test', tokenProvider: provider });
  const script = document.scripts[0]!;
  window.BugDrop = widget();
  script.dispatchEvent(new Event('load'));
  await controller.ready;
  await window[script.dataset.authTokenProvider as `__bugdropSdkTokenProvider_${string}`]!(binding);
  expect(provider).toHaveBeenCalledExactlyOnceWith(binding);
});

it.each(['classic-first', 'opt-in-first'])(
  'rejects mixed initialization %s without a second script or callback',
  async (order) => {
    const { BugDrop } = await import('../packages/browser/src/index.js');
    const { BugDropOptIn } = await import('../packages/browser/src/opt-in.js');
    const legacy = vi.fn();
    const next = vi.fn();
    const classic = () => BugDrop.init({ applicationId: 'app_test', tokenProvider: legacy });
    const optIn = () =>
      BugDropOptIn.init({ applicationId: 'app_test', tokenProviderWithMetadata: next });
    const controller = order === 'classic-first' ? classic() : optIn();
    expect(order === 'classic-first' ? optIn : classic).toThrow('modes cannot be mixed');
    expect(document.scripts).toHaveLength(1);
    expect(legacy).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    window.BugDrop = widget();
    document.scripts[0]!.dispatchEvent(new Event('load'));
    await controller.ready;
  }
);

it('reuses opt-in controller, rejects another application and never adopts a replacement callback', async () => {
  const state = await setup();
  const replacement = vi.fn();
  expect(
    state.BugDropOptIn.init({ applicationId: 'app_test', tokenProviderWithMetadata: replacement })
  ).toBe(state.controller);
  expect(() =>
    state.BugDropOptIn.init({ applicationId: 'app_other', tokenProviderWithMetadata: replacement })
  ).toThrow('another Application');
  await state.callback(binding);
  expect(state.provider).toHaveBeenCalledOnce();
  expect(replacement).not.toHaveBeenCalled();
  expect(document.scripts).toHaveLength(1);
});

it.each([
  'tokenProvider',
  'apiKey',
  'tenantId',
  'installationGeneration',
  'subject',
  'userId',
  'repo',
  'headers',
  'browserSdkVersion',
  'normalizedVersions',
])('rejects unsupported or mixed option %s before customer code', async (key) => {
  const { BugDropOptIn } = await import('../packages/browser/src/opt-in.js');
  const provider = vi.fn();
  expect(() =>
    BugDropOptIn.init({
      applicationId: 'app_test',
      tokenProviderWithMetadata: provider,
      [key]: 'PRIVATE_CANARY',
    })
  ).toThrow('unsupported fields');
  expect(provider).not.toHaveBeenCalled();
  expect(document.scripts).toHaveLength(0);
});

it.each([null, {}, { applicationId: 'app_test', tokenProviderWithMetadata: 1 }])(
  'rejects missing opt-in callback %#',
  async (options) => {
    const { BugDropOptIn } = await import('../packages/browser/src/opt-in.js');
    expect(() => BugDropOptIn.init(options as never)).toThrow();
    expect(document.scripts).toHaveLength(0);
  }
);

it('redacts callback failure and refuses repeats or changed binding for the same logical report', async () => {
  const state = await setup(vi.fn().mockRejectedValue(new Error('PRIVATE_CANARY')));
  await expect(state.callback(binding)).rejects.toThrow(/^Unable to authorize BugDrop$/);
  await expect(state.callback(binding)).rejects.toThrow(/^Unable to authorize BugDrop$/);
  await expect(state.callback({ ...binding, payloadDigest: 'A'.repeat(43) })).rejects.toThrow();
  expect(state.provider).toHaveBeenCalledOnce();
  expect(document.scripts).toHaveLength(1);
  expect(document.documentElement.outerHTML).not.toContain('PRIVATE_CANARY');
});

it('rejects reentrant and concurrent repeats before a second customer authorization request', async () => {
  const callbacks: { call?: (value: SubmissionBinding) => Promise<string> } = {};
  let resolve!: (value: ReturnType<typeof capability>) => void;
  let reentry!: Promise<string>;
  const provider = vi.fn(() => {
    reentry = callbacks.call!(binding);
    void reentry.catch(() => undefined);
    return new Promise<ReturnType<typeof capability>>((done) => {
      resolve = done;
    });
  });
  const state = await setup(provider);
  callbacks.call = state.callback;
  const first = callbacks.call(binding);
  await expect(reentry).rejects.toThrow('Unable to authorize');
  await expect(callbacks.call(binding)).rejects.toThrow('Unable to authorize');
  resolve(capability());
  await expect(first).resolves.toBe('synthetic-token');
  await expect(callbacks.call(binding)).rejects.toThrow('Unable to authorize');
  expect(provider).toHaveBeenCalledOnce();
  expect(document.scripts).toHaveLength(1);
});

it('rejects malformed bindings before callback, with no metadata or private fields forwarded', async () => {
  const state = await setup();
  await expect(state.callback({ ...binding, userId: 'PRIVATE_CANARY' } as never)).rejects.toThrow();
  await expect(state.callback({ ...binding, payloadDigest: 'bad' })).rejects.toThrow();
  expect(state.provider).not.toHaveBeenCalled();
  await state.callback(binding);
  expect(state.provider).toHaveBeenCalledOnce();
});
