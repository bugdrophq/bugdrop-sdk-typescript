const LIMIT = 1024;
function reject(): never {
  throw new Error('Unable to authorize BugDrop');
}
export function parseBinding(body: string): { submissionId: string; payloadDigest: string } {
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

export async function readBindingBody(request: Request): Promise<string> {
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > LIMIT)) reject();
  const reader = request.body?.getReader();
  if (!reader) reject();
  const bytes = new Uint8Array(LIMIT);
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  request.signal.addEventListener('abort', abort, { once: true });
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
    request.signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
