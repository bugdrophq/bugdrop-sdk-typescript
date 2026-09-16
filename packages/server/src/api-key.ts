import { createHmac } from 'node:crypto';

const API_KEY_PREFIX = 'bd_api_v1';
const AUTH_PREFIX = 'bd_auth_v1';
const AUTH_DOMAIN = 'bugdrop:auth:v1\0';

interface CanonicalCapabilityRequest {
  method: 'POST';
  url: string;
  body: string;
}

export interface CapabilityRequestAuthenticator {
  authenticateRequest(
    request: CanonicalCapabilityRequest
  ): Promise<Readonly<Record<string, string>>>;
}

export function createApiKeyAuthenticator(
  apiKey: string | undefined
): CapabilityRequestAuthenticator {
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
    async authenticateRequest(_request: CanonicalCapabilityRequest) {
      return { Authorization: authorization };
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

function invalidApiKey(): TypeError {
  return new TypeError('BugDrop requires a valid API key');
}
