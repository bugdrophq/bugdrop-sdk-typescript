import { createHmac } from 'node:crypto';

const API_KEY_PREFIX = 'bd_api_v1';
const AUTH_PREFIX = 'bd_auth_v1';
const SUBJECT_PREFIX = 'bdsub_v1_';
const AUTH_DOMAIN = 'bugdrop:auth:v1\0';
const SUBJECT_DOMAIN = 'bugdrop:subject:v1\0';

interface CanonicalCapabilityRequest {
  method: 'POST';
  url: string;
  body: string;
}

interface PreparedCapabilityIdentity {
  wireSubject: string;
  authenticateRequest(
    request: CanonicalCapabilityRequest
  ): Promise<Readonly<Record<string, string>>>;
}

export interface CapabilityIdentityStrategy {
  prepareIdentity(subject: string): PreparedCapabilityIdentity;
}

export function createApiKeyStrategy(apiKey: string | undefined): CapabilityIdentityStrategy {
  const [prefix, keyId, encodedRoot, extra] = typeof apiKey === 'string' ? apiKey.split('.') : [];
  if (
    prefix !== API_KEY_PREFIX ||
    extra !== undefined ||
    keyId === undefined ||
    encodedRoot === undefined ||
    apiKey !== apiKey?.trim()
  ) {
    throw invalidApiKey();
  }

  decodeCanonicalBase64url(keyId, 16);
  const rootSecret = decodeCanonicalBase64url(encodedRoot, 32);
  const authSecret = createHmac('sha256', rootSecret)
    .update(AUTH_DOMAIN)
    .update(keyId, 'utf8')
    .digest('base64url');
  const authorization = `Bearer ${AUTH_PREFIX}.${keyId}.${authSecret}`;

  return Object.freeze({
    prepareIdentity(subject: string): PreparedCapabilityIdentity {
      const subjectBytes = encodeValidSubject(subject);
      const digest = createHmac('sha256', rootSecret)
        .update(SUBJECT_DOMAIN)
        .update(subjectBytes)
        .digest('base64url');
      return Object.freeze({
        wireSubject: `${SUBJECT_PREFIX}${digest}`,
        async authenticateRequest(_request: CanonicalCapabilityRequest) {
          return { Authorization: authorization };
        },
      });
    },
  });
}

function decodeCanonicalBase64url(value: string, byteLength: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalidApiKey();
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== byteLength || decoded.toString('base64url') !== value) {
    throw invalidApiKey();
  }
  return decoded;
}

function encodeValidSubject(value: string): Buffer {
  if (typeof value !== 'string') throw new TypeError('subject must be a valid opaque identifier');
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length === 0 || encoded.length > 1_024 || encoded.toString('utf8') !== value) {
    throw new TypeError('subject must be 1-1024 valid UTF-8 bytes');
  }
  return encoded;
}

function invalidApiKey(): TypeError {
  return new TypeError('BugDrop requires a valid API key');
}
