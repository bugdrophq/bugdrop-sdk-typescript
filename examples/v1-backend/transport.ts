import type { SubmissionTokenProvider } from '@bugdrop/browser';

const PATH = '/api/bugdrop-capability/v1';
const REQUEST_LIMIT = 1024;
const RESPONSE_LIMIT = 32768;

// The customer's CSRF token is intentionally distinct from the server-only BugDrop API key.
export function createV1TokenProvider(csrfToken: () => string): SubmissionTokenProvider {
  if (typeof csrfToken !== 'function')
    throw new TypeError('A customer CSRF token source is required');
  return async (binding) => {
    try {
      const origin = globalThis.location.origin;
      const url = new URL(origin);
      const loopback =
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        url.hostname.endsWith('.localhost');
      if (
        url.origin !== origin ||
        globalThis.location.protocol !== url.protocol ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      )
        throw new Error();
      if (
        !binding ||
        typeof binding !== 'object' ||
        Object.keys(binding).length !== 2 ||
        !Object.keys(binding).every((key) => ['submissionId', 'payloadDigest'].includes(key)) ||
        typeof binding.submissionId !== 'string' ||
        typeof binding.payloadDigest !== 'string'
      ) {
        throw new Error();
      }
      const token = csrfToken();
      if (typeof token !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(token)) throw new Error();
      const body = JSON.stringify(binding);
      if (new TextEncoder().encode(body).byteLength > REQUEST_LIMIT) throw new Error();
      const response = await fetch(`${origin}${PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-BugDrop-CSRF-Token': token },
        body,
        redirect: 'error',
        credentials: 'same-origin',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (
        response.status !== 200 ||
        response.redirected ||
        response.headers.get('Content-Type') !== 'application/json' ||
        response.headers.get('Cache-Control') !== 'no-store'
      ) {
        void response.body?.cancel().catch(() => {});
        throw new Error();
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const bytes = new Uint8Array(RESPONSE_LIMIT);
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (size + chunk.value.byteLength > bytes.length) throw new Error();
          bytes.set(chunk.value, size);
          size += chunk.value.byteLength;
        }
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const value: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, size))
      );
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      const result = value as Record<string, unknown>;
      if (
        Object.keys(result).length !== 3 ||
        result.schemaVersion !== 1 ||
        typeof result.token !== 'string' ||
        !result.token ||
        result.token.length > 16384 ||
        typeof result.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(result.expiresAt))
      )
        throw new Error();
      // The browser loader validates canonical expiration and lifetime before widget delivery.
      return { schemaVersion: 1, token: result.token, expiresAt: result.expiresAt };
    } catch {
      throw new Error('Unable to authorize BugDrop');
    }
  };
}
