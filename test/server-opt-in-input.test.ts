import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BugDropOptIn } from '../packages/server/src/opt-in.js';
import {
  binding,
  browserMetadata,
  clock,
  options,
} from '../packages/server/test/opt-in-fixture.js';
import { hash } from '../packages/server/src/opt-in-values.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(clock);
});
afterEach(() => vi.useRealTimers());

describe('local opt-in input boundary before any transport', () => {
  it.each([
    'applicationId',
    'credentialId',
    'installationGeneration',
    'deploymentDigest',
    'keyId',
  ] as const)('rejects coercible singleton array %s', (field) => {
    const fetch = vi.fn();
    const config = options(fetch);
    expect(() => new BugDropOptIn({ ...config, [field]: [config[field]] } as never)).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects getters and symbol fields without reading the accessor', async () => {
    const fetch = vi.fn();
    const client = new BugDropOptIn(options(fetch));
    const getter = vi.fn(() => '0.2.0');
    const metadata = { metadataVersion: 1 };
    Object.defineProperty(metadata, 'browserSdkVersion', { get: getter, enumerable: true });
    await expect(
      client.createSubmissionCapability(binding, metadata as never)
    ).rejects.toMatchObject({ code: 'rejected_before_send' });
    await expect(
      client.createSubmissionCapability({ ...binding, [Symbol('secret')]: true }, browserMetadata)
    ).rejects.toMatchObject({ code: 'rejected_before_send' });
    expect(getter).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects sparse catalogs even with the correct digest of their JSON representation', () => {
    const config = options(vi.fn());
    const server = new Array<string>(1);
    config.catalog = { ...config.catalog, server };
    config.catalogDigest = hash('bugdrop:version-catalog:v1', [
      1,
      1,
      server,
      config.catalog.browser,
      config.catalog.widget,
    ]);
    expect(() => new BugDropOptIn(config)).toThrow();
    expect(() => new BugDropOptIn({ ...options(vi.fn()), fetch: null } as never)).toThrow();
  });

  it('enforces the serialized request-body budget before fetch', async () => {
    const fetch = vi.fn();
    const config = {
      ...options(fetch),
      endpoint: `https://${'a'.repeat(33_000)}.example/v2/submission-capabilities`,
    };
    await expect(
      new BugDropOptIn(config).createSubmissionCapability(binding, browserMetadata)
    ).rejects.toMatchObject({ code: 'rejected_before_send' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not treat an array version as a valid unknown scalar claim', async () => {
    const fetch = vi.fn();
    await expect(
      new BugDropOptIn(options(fetch)).createSubmissionCapability(binding, {
        metadataVersion: 1,
        browserSdkVersion: ['0.2.0'],
      } as never)
    ).rejects.toMatchObject({ code: 'rejected_before_send' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
