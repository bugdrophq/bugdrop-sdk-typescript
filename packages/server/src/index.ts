import packageMetadata from '../package.json';
import {
  BUGDROP_CAPABILITY_MEDIA_TYPE,
  BUGDROP_CONTRACT_VERSION,
  parseSubmissionBinding,
  parseUsableSubmissionCapability,
  type SubmissionCapability,
  type SubmissionCapabilityRequest,
  type SubmissionBinding,
} from '../../contracts/src/index.js';
import { createApiKeyAuthenticator, type CapabilityRequestAuthenticator } from './api-key.js';

const DEFAULT_CAPABILITY_ENDPOINT = 'https://api.bugdrop.dev/v1/submission-capabilities';
const DEFAULT_TIMEOUT_MS = 10_000;
const SDK_VERSION = packageMetadata.version;

assertServerRuntime();

export interface BugDropServerOptions {
  apiKey: string | undefined;
  endpoint?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface CreateSubmissionTokenOptions extends SubmissionBinding {
  origin?: string;
  environment?: string;
  signal?: AbortSignal;
}

export class BugDropServerError extends Error {
  readonly code: 'request_failed' | 'invalid_response';
  readonly status: number | undefined;

  constructor(
    message: string,
    code: BugDropServerError['code'],
    status: number | undefined = undefined
  ) {
    super(message);
    this.name = 'BugDropServerError';
    this.code = code;
    this.status = status;
  }
}

export class BugDrop {
  readonly #authenticator: CapabilityRequestAuthenticator;
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: BugDropServerOptions) {
    assertServerRuntime();
    if (!options || typeof options !== 'object') {
      throw new TypeError('BugDrop requires an options object');
    }
    this.#authenticator = createApiKeyAuthenticator(options.apiKey);
    this.#endpoint = validateEndpoint(options.endpoint ?? DEFAULT_CAPABILITY_ENDPOINT);
    this.#timeoutMs = validateTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== 'function') {
      throw new Error('BugDrop requires a Fetch API implementation');
    }
    Object.freeze(this);
  }

  async createSubmissionToken(
    options: CreateSubmissionTokenOptions
  ): Promise<SubmissionCapability> {
    if (!options || typeof options !== 'object') {
      throw new TypeError('createSubmissionToken requires an options object');
    }
    const requestBody = createRequestBody(options);
    const body = JSON.stringify(requestBody);
    const authenticationHeaders = await this.#authenticator.authenticateRequest({
      method: 'POST',
      url: this.#endpoint,
      body,
    });
    const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: {
          Accept: BUGDROP_CAPABILITY_MEDIA_TYPE,
          'Content-Type': 'application/json',
          'X-BugDrop-Contract-Version': String(BUGDROP_CONTRACT_VERSION),
          'X-BugDrop-SDK-Version': SDK_VERSION,
          ...authenticationHeaders,
        },
        body,
        redirect: 'error',
        signal,
      });
    } catch {
      throw new BugDropServerError(
        'Unable to reach the BugDrop capability service',
        'request_failed'
      );
    }

    if (!response.ok) {
      throw new BugDropServerError(
        'BugDrop rejected the capability request',
        'request_failed',
        response.status
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
      return parseUsableSubmissionCapability(payload);
    } catch {
      throw new BugDropServerError(
        'BugDrop returned an invalid capability response',
        'invalid_response',
        response.status
      );
    }
  }

  toJSON(): string {
    return '[BugDrop server client]';
  }
}

function createRequestBody(options: CreateSubmissionTokenOptions): SubmissionCapabilityRequest {
  if (!options || typeof options !== 'object') {
    throw new TypeError('createSubmissionToken requires an options object');
  }
  assertOnlyKeys(options, ['submissionId', 'payloadDigest', 'origin', 'environment', 'signal']);
  const binding = parseSubmissionBinding({
    submissionId: options.submissionId,
    payloadDigest: options.payloadDigest,
  });
  const body: SubmissionCapabilityRequest = {
    schemaVersion: BUGDROP_CONTRACT_VERSION,
    ...binding,
  };
  if (options.origin !== undefined) body.origin = validateOrigin(options.origin);
  if (options.environment !== undefined) {
    body.environment = validateEnvironment(options.environment);
  }
  return body;
}

function assertOnlyKeys(value: object, allowedKeys: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new TypeError('createSubmissionToken options contain unsupported fields');
  }
}

function validateOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('origin must be a valid URL origin');
  }
  if (
    url.origin !== value ||
    url.hostname.endsWith('.') ||
    url.username ||
    url.password ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname)))
  ) {
    throw new TypeError('origin must be an exact HTTPS origin or HTTP loopback origin');
  }
  return url.origin;
}

function validateEnvironment(value: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)) {
    throw new TypeError('environment must be 1-64 letters, numbers, underscores, or hyphens');
  }
  return value;
}

function validateEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('endpoint must be a valid URL');
  }
  const localDevelopment = isLoopbackHost(url.hostname);
  if (
    (url.protocol !== 'https:' && !(localDevelopment && url.protocol === 'http:')) ||
    url.username ||
    url.password
  ) {
    throw new TypeError('endpoint must use HTTPS without embedded credentials');
  }
  if (url.search || url.hash) {
    throw new TypeError('endpoint must not include a query string or fragment');
  }
  return url.href;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]'
  );
}

function validateTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 60_000) {
    throw new TypeError('timeoutMs must be between 1 and 60000');
  }
  return value;
}

function assertServerRuntime(): void {
  if (typeof globalThis === 'object' && 'window' in globalThis && 'document' in globalThis) {
    throw new Error('@bugdrop/server cannot be imported into browser code');
  }
}

export type { SubmissionCapability } from '../../contracts/src/index.js';
