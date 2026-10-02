import { BugDrop, type BugDropServerOptions } from '@bugdrop/server';

const PATH = '/api/bugdrop-capability/v1';
const LIMIT = 1024;
const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export interface V1BackendOptions extends BugDropServerOptions {
  origin: string;
  environment?: string;
}

// Enforce the customer's session, CSRF token, authorization and rate limits here.
// The policy must inspect headers only; it must not consume or log the body.
export type CustomerPolicy = (request: Request) => boolean | Promise<boolean>;

function reject(): never {
  throw new Error('Unable to authorize BugDrop');
}

function canonicalOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('origin must be a canonical HTTPS origin');
  }
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    url.hostname.endsWith('.') ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  ) {
    throw new TypeError('origin must be a canonical HTTPS origin or HTTP loopback origin');
  }
  return value;
}

function parse(body: string): { submissionId: string; payloadDigest: string } {
  const value: unknown = JSON.parse(body);
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject();
  // JSON.parse alone silently accepts duplicate names, including escaped aliases.
  const seen = new Set<string>();
  for (const match of body.matchAll(/"(?:\\[\s\S]|[^"\\])*"/g)) {
    if (!/^\s*:/.test(body.slice(match.index + match[0].length))) continue;
    const name: string = JSON.parse(match[0]);
    if (seen.has(name)) reject();
    seen.add(name);
  }
  const fields = value as Record<string, unknown>;
  if (
    Object.keys(fields).length !== 2 ||
    !Object.keys(fields).every((key) => ['submissionId', 'payloadDigest'].includes(key)) ||
    typeof fields.submissionId !== 'string' ||
    typeof fields.payloadDigest !== 'string'
  )
    reject();
  return { submissionId: fields.submissionId, payloadDigest: fields.payloadDigest };
}

async function read(request: Request): Promise<string> {
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > LIMIT)) reject();
  const reader = request.body?.getReader();
  if (!reader) reject();
  const bytes = new Uint8Array(LIMIT);
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (request.signal.aborted || size + chunk.value.byteLength > LIMIT) reject();
      bytes.set(chunk.value, size);
      size += chunk.value.byteLength;
    }
    if (length !== null && Number(length) !== size) reject();
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes.subarray(0, size)
    );
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createV1Handler(options: V1BackendOptions, customerPolicy: CustomerPolicy) {
  if (typeof customerPolicy !== 'function') {
    throw new TypeError('A customer access/CSRF/rate policy is required');
  }
  const origin = canonicalOrigin(options.origin);
  const { environment } = options;
  const client = new BugDrop(options);
  const endpoint = `${origin}${PATH}`;
  return async (request: Request): Promise<Response> => {
    try {
      if (
        request.method !== 'POST' ||
        request.url !== endpoint ||
        request.headers.get('Origin') !== origin ||
        request.headers.get('Content-Type') !== 'application/json' ||
        request.headers.has('Content-Encoding') ||
        request.signal.aborted
      )
        reject();
      if ((await customerPolicy(request)) !== true) reject();
      const binding = parse(await read(request));
      if (request.signal.aborted) reject();
      const capability = await client.createSubmissionToken({
        ...binding,
        origin,
        ...(environment === undefined ? {} : { environment }),
        signal: request.signal,
      });
      return new Response(JSON.stringify(capability), { status: 200, headers: HEADERS });
    } catch {
      if (!request.body?.locked) void request.body?.cancel().catch(() => {});
      return new Response('{"error":"unable_to_authorize_bugdrop"}', {
        status: 502,
        headers: HEADERS,
      });
    }
  };
}
