export const BUGDROP_CONTRACT_VERSION = 1 as const;
export const BUGDROP_CAPABILITY_MEDIA_TYPE =
  'application/vnd.bugdrop.submission-capability.v1+json' as const;
export const BUGDROP_MAX_CAPABILITY_TTL_MS = 5 * 60 * 1_000;

export interface SubmissionCapability {
  schemaVersion: typeof BUGDROP_CONTRACT_VERSION;
  token: string;
  expiresAt: string;
}

export interface SubmissionBinding {
  submissionId: string;
  payloadDigest: string;
}

export interface SubmissionCapabilityRequest extends SubmissionBinding {
  schemaVersion: typeof BUGDROP_CONTRACT_VERSION;
  origin?: string;
  environment?: string;
}

export function parseSubmissionBinding(value: unknown): SubmissionBinding {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !['submissionId', 'payloadDigest'].includes(key))
  ) {
    throw new TypeError('BugDrop requires a valid submission binding');
  }
  const { submissionId, payloadDigest } = value;
  if (typeof submissionId !== 'string') {
    throw new TypeError('submissionId must be 1-200 valid UTF-8 bytes');
  }
  const byteLength = validUtf8ByteLength(submissionId);
  if (byteLength === undefined || byteLength === 0 || byteLength > 200) {
    throw new TypeError('submissionId must be 1-200 valid UTF-8 bytes');
  }
  if (
    typeof payloadDigest !== 'string' ||
    !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(payloadDigest)
  ) {
    throw new TypeError('payloadDigest must be canonical base64url SHA-256');
  }
  return { submissionId, payloadDigest };
}

function validUtf8ByteLength(value: string): number | undefined {
  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) byteLength += 1;
    else if (codeUnit <= 0x7ff) byteLength += 2;
    else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return undefined;
      byteLength += 4;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return undefined;
    else byteLength += 3;
  }
  return byteLength;
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
