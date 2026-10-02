import { BugDrop, type BugDropServerOptions } from '@bugdrop/server';

const PATH = '/api/bugdrop-capability/v1';
const LIMIT = 1024;
const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export interface V1BackendOptions extends BugDropServerOptions {
  origin: string;
  environment?: string;
}

// Enforce session, CSRF, authorization, rate limits and atomic ID-to-digest reuse here.
// Inspect request headers and the parsed binding; do not consume or log the body.
export type CustomerBinding = Readonly<{ submissionId: string; payloadDigest: string }>;
export type CustomerPolicy = (
  request: Request,
  binding: CustomerBinding
) => boolean | Promise<boolean>;

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
      !(
        url.protocol === 'http:' &&
        (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
          url.hostname.endsWith('.localhost'))
      ))
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
    typeof fields.payloadDigest !== 'string' ||
    !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(fields.payloadDigest) ||
    !validUtf8Id(fields.submissionId)
  )
    reject();
  return { submissionId: fields.submissionId, payloadDigest: fields.payloadDigest };
}

function validUtf8Id(value: string): boolean {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x7f) bytes += 1;
    else if (unit <= 0x7ff) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      bytes += 4;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
    else bytes += 3;
    if (bytes > 200) return false;
  }
  return bytes > 0;
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
      const binding = Object.freeze(parse(await read(request)));
      if ((await customerPolicy(request, binding)) !== true) reject();
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
