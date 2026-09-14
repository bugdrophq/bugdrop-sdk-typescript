export const BUGDROP_CONTRACT_VERSION = 1 as const;
export const BUGDROP_CAPABILITY_MEDIA_TYPE =
  'application/vnd.bugdrop.submission-capability.v1+json' as const;
export const BUGDROP_MAX_CAPABILITY_TTL_MS = 5 * 60 * 1_000;

export interface SubmissionCapability {
  schemaVersion: typeof BUGDROP_CONTRACT_VERSION;
  token: string;
  expiresAt: string;
}

export interface SubmissionCapabilityRequest {
  schemaVersion: typeof BUGDROP_CONTRACT_VERSION;
  subject: string;
  origin?: string;
  environment?: string;
}

export function parseSubmissionCapability(value: unknown): SubmissionCapability {
  if (!isRecord(value)) {
    throw new TypeError('BugDrop returned an invalid capability response');
  }

  if (
    value.schemaVersion !== BUGDROP_CONTRACT_VERSION ||
    typeof value.token !== 'string' ||
    value.token.length === 0 ||
    value.token.length > 16_384 ||
    typeof value.expiresAt !== 'string' ||
    !isIsoDate(value.expiresAt)
  ) {
    throw new TypeError('BugDrop returned an invalid capability response');
  }

  return {
    schemaVersion: BUGDROP_CONTRACT_VERSION,
    token: value.token,
    expiresAt: value.expiresAt,
  };
}

export function parseUsableSubmissionCapability(
  value: unknown,
  now = Date.now()
): SubmissionCapability {
  const capability = parseSubmissionCapability(value);
  const expiration = Date.parse(capability.expiresAt);
  if (expiration <= now || expiration > now + BUGDROP_MAX_CAPABILITY_TTL_MS) {
    throw new TypeError('BugDrop returned an invalid capability response');
  }
  return capability;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
