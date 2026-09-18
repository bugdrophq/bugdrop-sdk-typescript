import packageMetadata from '../package.json';
import { initialize, type BugDropBrowserOptions, type BugDropController } from './loader.js';
import type { SubmissionBinding, SubmissionCapability } from '../../contracts/src/index.js';

export type BrowserVersionMetadata = Readonly<{
  metadataVersion: 1;
  browserSdkVersion: string;
}>;
export type SubmissionTokenProviderWithMetadata = (
  binding: SubmissionBinding,
  metadata: BrowserVersionMetadata
) => SubmissionCapability | Promise<SubmissionCapability>;
export interface BugDropOptInOptions extends Omit<BugDropBrowserOptions, 'tokenProvider'> {
  tokenProviderWithMetadata: SubmissionTokenProviderWithMetadata;
}

const SDK_VERSION = packageMetadata.version;
const attempted = new Set<string>();
const allowedKeys = [
  'applicationId',
  'tokenProviderWithMetadata',
  'widgetUrl',
  'loadTimeoutMs',
  'theme',
  'position',
  'button',
];

export class BugDropOptIn {
  static init(options: BugDropOptInOptions): BugDropController {
    if (!options || typeof options !== 'object') {
      throw new TypeError('BugDropOptIn.init requires an options object');
    }
    if (Object.keys(options).some((key) => !allowedKeys.includes(key))) {
      throw new TypeError('BugDrop opt-in options contain unsupported fields');
    }
    const { tokenProviderWithMetadata, ...presentation } = options;
    if (typeof tokenProviderWithMetadata !== 'function') {
      throw new TypeError('BugDrop opt-in requires a metadata token provider');
    }
    // A failed or reentrant call cannot request a replacement for the same report.
    // Binding validation occurs in the shared loader before this callback.
    const applicationId = presentation.applicationId;
    return initialize(
      {
        ...presentation,
        tokenProvider(binding) {
          const attemptKey = JSON.stringify([applicationId, binding.submissionId]);
          if (attempted.has(attemptKey)) {
            throw new Error('Unable to authorize BugDrop');
          }
          attempted.add(attemptKey);
          const metadata: BrowserVersionMetadata = Object.freeze({
            metadataVersion: 1,
            browserSdkVersion: SDK_VERSION,
          });
          return tokenProviderWithMetadata(binding, metadata);
        },
      },
      'opt-in'
    );
  }
}
