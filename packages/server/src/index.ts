import { createHmac } from 'node:crypto';
import {
  BUGDROP_CAPABILITY_MEDIA_TYPE,
  BUGDROP_CONTRACT_VERSION,
  parseUsableSubmissionCapability,
  type SubmissionCapability,
  type SubmissionCapabilityRequest,
} from '../../contracts/src/index.js';

const DEFAULT_CAPABILITY_ENDPOINT =
  'https://bugdrop.neonwatty.workers.dev/v1/submission-capabilities';
const DEFAULT_TIMEOUT_MS = 10_000;
const SUBJECT_DOMAIN_SEPARATOR = 'bugdrop:subject:v1\0';

assertServerRuntime();

export interface BugDropServerOptions {
  secretKey: string | undefined;
  subjectKey: string | undefined;
  endpoint?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface CreateSubmissionTokenOptions {
  subject: string;
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
  readonly #secretKey: string;
  readonly #subjectKey: string;
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: BugDropServerOptions) {
    assertServerRuntime();
    if (!options || typeof options !== 'object') {
      throw new TypeError('BugDrop requires an options object');
    }
    if (
      typeof options.secretKey !== 'string' ||
      options.secretKey.length < 16 ||
      options.secretKey !== options.secretKey.trim()
    ) {
      throw new TypeError('BugDrop requires a valid server secret key');
    }
    if (
      typeof options.subjectKey !== 'string' ||
      options.subjectKey.length < 32 ||
      options.subjectKey !== options.subjectKey.trim()
    ) {
      throw new TypeError('BugDrop requires a valid stable subject key');
    }

    this.#secretKey = options.secretKey;
    this.#subjectKey = options.subjectKey;
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
    const requestBody = createRequestBody(options, this.#subjectKey);
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
          Authorization: `Bearer ${this.#secretKey}`,
          'Content-Type': 'application/json',
          'X-BugDrop-Contract-Version': String(BUGDROP_CONTRACT_VERSION),
        },
        body: JSON.stringify(requestBody),
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

export function pseudonymizeSubject(subject: string, subjectKey: string): string {
  validateSubject(subject);
  if (
    typeof subjectKey !== 'string' ||
    subjectKey.length < 32 ||
    subjectKey !== subjectKey.trim()
  ) {
    throw new TypeError('A valid stable subject key is required for subject pseudonymization');
  }
  const digest = createHmac('sha256', subjectKey)
    .update(SUBJECT_DOMAIN_SEPARATOR)
    .update(subject, 'utf8')
    .digest('base64url');
  return `bdsub_v1_${digest}`;
}

function createRequestBody(
  options: CreateSubmissionTokenOptions,
  subjectKey: string
): SubmissionCapabilityRequest {
  if (!options || typeof options !== 'object') {
    throw new TypeError('createSubmissionToken requires an options object');
  }
  assertOnlyKeys(options, ['subject', 'origin', 'environment', 'signal']);
  const body: SubmissionCapabilityRequest = {
    schemaVersion: BUGDROP_CONTRACT_VERSION,
    subject: pseudonymizeSubject(options.subject, subjectKey),
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

function validateSubject(value: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_024) {
    throw new TypeError('subject must be a non-empty opaque identifier');
  }
}

function validateOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('origin must be a valid URL origin');
  }
  if (url.origin !== value || url.username || url.password) {
    throw new TypeError('origin must contain only a URL origin');
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
  const localDevelopment = url.hostname === 'localhost' || url.hostname.endsWith('.localhost');
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
