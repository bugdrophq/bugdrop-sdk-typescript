import type { SubmissionTokenProviderWithMetadata } from '@bugdrop/browser/opt-in';

// This module is the only example module intended for browser bundles.
export const tokenProviderWithMetadata: SubmissionTokenProviderWithMetadata = async (
  binding,
  metadata
) => {
  try {
    const origin = globalThis.location.origin;
    if (globalThis.location.protocol !== 'https:') throw new Error();
    const body = JSON.stringify({ binding, metadata });
    if (new TextEncoder().encode(body).byteLength > 2048) throw new Error();
    const response = await fetch(`${origin}/api/bugdrop-capability/v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const bytes = new Uint8Array(32768);
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
      new TextEncoder().encode(result.token).byteLength > 16384 ||
      typeof result.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(result.expiresAt))
    )
      throw new Error();
    // The P2 loader applies the shared capability lifetime validation before widget delivery.
    return { schemaVersion: 1, token: result.token, expiresAt: result.expiresAt };
  } catch {
    throw new Error('Unable to authorize BugDrop');
  }
};
