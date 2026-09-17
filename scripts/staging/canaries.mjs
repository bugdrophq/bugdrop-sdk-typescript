import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

export function credentialCanaries(apiKey) {
  const [prefix, keyId, root] = apiKey.split('.');
  assert.equal(prefix, 'bd_api_v1');
  const secret = createHmac('sha256', Buffer.from(root, 'base64url'))
    .update(`bugdrop:auth:v1\0${keyId}`, 'utf8')
    .digest('base64url');
  return [apiKey, root, secret, `Bearer bd_auth_v1.${keyId}.${secret}`];
}
