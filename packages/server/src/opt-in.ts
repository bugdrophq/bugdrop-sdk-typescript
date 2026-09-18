import type { SubmissionBinding, SubmissionCapability } from '../../contracts/src/index.js';
import {
  configuration,
  type BugDropOptInOptions,
  type OptInConfiguration,
} from './opt-in-config.js';
import { BugDropOptInError, exchange } from './opt-in-exchange.js';
import { request, type BrowserMetadata } from './opt-in-protocol.js';

function serverOnly() {
  if ('window' in globalThis && 'document' in globalThis)
    throw new Error('@bugdrop/server cannot be imported into browser code');
}
serverOnly();

export class BugDropOptIn {
  readonly #config: OptInConfiguration;
  constructor(options: BugDropOptInOptions) {
    serverOnly();
    try {
      this.#config = configuration(options);
    } catch {
      throw new BugDropOptInError('rejected_before_send');
    }
    Object.freeze(this);
  }

  async createSubmissionCapability(
    binding: SubmissionBinding,
    metadata: BrowserMetadata
  ): Promise<SubmissionCapability> {
    let prepared;
    try {
      serverOnly();
      prepared = request(this.#config, binding, metadata);
    } catch {
      throw new BugDropOptInError('rejected_before_send');
    }
    return exchange(this.#config, prepared);
  }

  toJSON(): string {
    return '[BugDrop opt-in server client]';
  }
}

export { BugDropOptInError };
export type { BugDropOptInOptions, ConfirmationKey, VersionCatalog } from './opt-in-config.js';
export type { BrowserMetadata } from './opt-in-protocol.js';
export type { SubmissionBinding, SubmissionCapability } from '../../contracts/src/index.js';
