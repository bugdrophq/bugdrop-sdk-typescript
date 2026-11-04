export function canonicalOrigin(value: string): string {
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

export function adapterPath(path = '/api/bugdrop-capability/v1/'): string {
  if (
    !/^\/[A-Za-z0-9/_-]+$/.test(path) ||
    path.includes('//') ||
    new URL(path, 'https://adapter.invalid').pathname !== path
  )
    throw new TypeError('path must be an exact absolute path');
  return path;
}

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
export function adapterFailure(): Response {
  return new Response('{"error":"unable_to_authorize_bugdrop"}', { status: 502, headers: HEADERS });
}
export function disabledResponse(): Response {
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}
