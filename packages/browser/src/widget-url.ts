export function validateServiceUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${field} must be a valid URL`);
  }
  const localDevelopment = isLoopbackHost(url.hostname);
  if (
    (url.protocol !== 'https:' && !(localDevelopment && url.protocol === 'http:')) ||
    url.username ||
    url.password
  ) {
    throw new TypeError(`${field} must use HTTPS without embedded credentials`);
  }
  if (url.search || url.hash) {
    throw new TypeError(`${field} must not include a query string or fragment`);
  }
  return url.href;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]'
  );
}
