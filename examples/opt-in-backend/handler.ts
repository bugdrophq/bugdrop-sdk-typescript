import {
  BugDropOptIn,
  type BugDropOptInOptions,
  type BrowserMetadata,
  type SubmissionBinding,
} from '@bugdrop/server/opt-in';

// The customer hook must enforce access, CSRF and rate limits and return exactly true.
// It may inspect local cookies/headers, but must not consume or log the body.
export type CustomerPolicy = (request: Request) => boolean | Promise<boolean>;
const PATH = '/api/bugdrop-capability/v2';
const LIMIT = 2048;
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function reject(): never {
  throw new Error('Unable to authorize BugDrop');
}

function exact(value: unknown, names: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject();
  const fields = Object.keys(value);
  if (fields.length !== names.length || fields.some((key) => !names.includes(key))) reject();
  return value as Record<string, unknown>;
}

function parse(body: string) {
  const value: unknown = JSON.parse(body);
  // All six schema member names are unique, including across nested objects.
  // Scan complete JSON string tokens so escaped names cannot conceal duplicates.
  const seen = new Set<string>();
  for (const match of body.matchAll(/"(?:\\[\s\S]|[^"\\])*"/g)) {
    if (!/^\s*:/.test(body.slice(match.index + match[0].length))) continue;
    const name: string = JSON.parse(match[0]);
    if (seen.has(name)) reject();
    seen.add(name);
  }
  const outer = exact(value, ['binding', 'metadata']);
  const binding = exact(outer.binding, ['submissionId', 'payloadDigest']);
  const metadata = exact(outer.metadata, ['metadataVersion', 'browserSdkVersion']);
  // P1 validates scalar types, UTF-8, digest canonicality and version grammar before send.
  return {
    binding: binding as unknown as SubmissionBinding,
    metadata: metadata as unknown as BrowserMetadata,
  };
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
    // A broken stream's cancellation must not delay the fixed error response.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createOptInHandler(
  serverConfig: BugDropOptInOptions,
  customerPolicy: CustomerPolicy
) {
  if (typeof customerPolicy !== 'function')
    throw new TypeError('A customer access/CSRF/rate policy is required');
  const client = new BugDropOptIn(serverConfig);
  const endpoint = `${serverConfig.origin}${PATH}`;
  const origin = serverConfig.origin;
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
      const { binding, metadata } = parse(await read(request));
      if (request.signal.aborted) reject();
      const capability = await client.createSubmissionCapability(binding, metadata);
      return new Response(JSON.stringify(capability), { status: 200, headers });
    } catch {
      if (!request.body?.locked) void request.body?.cancel().catch(() => {});
      return new Response('{"error":"unable_to_authorize_bugdrop"}', { status: 502, headers });
    }
  };
}
