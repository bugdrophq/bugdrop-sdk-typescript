import { createHash } from 'node:crypto';

export function requireValue(value: unknown): asserts value {
  if (!value) throw new Error('Invalid opt-in value');
}

export function record(value: unknown, expected: readonly string[]) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  requireValue(Object.getPrototypeOf(value) === Object.prototype);
  const fields = Object.getOwnPropertyDescriptors(value);
  requireValue(Reflect.ownKeys(fields).length === expected.length);
  requireValue(expected.every((key) => fields[key] && 'value' in fields[key]));
  return value as Record<string, unknown>;
}

export function text(value: unknown): string {
  requireValue(typeof value === 'string');
  // UTF-8 replacement must never silently change signed data.
  requireValue(Buffer.from(value).toString('utf8') === value);
  return value;
}

export function stableVersion(value: unknown): string {
  const version = text(value);
  requireValue(/^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/.test(version));
  return version;
}

export function base64(value: unknown, length: number): Buffer {
  const encoded = text(value);
  const result = Buffer.from(encoded, 'base64url');
  requireValue(result.length === length && result.toString('base64url') === encoded);
  return result;
}

export function integer(value: unknown): number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
  return value;
}

export function uuid(value: unknown): string {
  const result = text(value);
  requireValue(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result)
  );
  return result;
}

export function hash(domain: string, tuple: unknown): string {
  return createHash('sha256').update(`${domain}\0`).update(JSON.stringify(tuple)).digest('hex');
}

export function hex(value: unknown): string {
  const result = text(value);
  requireValue(/^[0-9a-f]{64}$/.test(result));
  return result;
}

export function https(value: unknown, endpoint: boolean): string {
  const result = text(value);
  const url = new URL(result);
  requireValue(
    url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
  );
  requireValue(!url.hostname.endsWith('.'));
  requireValue(
    endpoint
      ? url.href === result && result === `${url.origin}/v2/submission-capabilities`
      : url.origin === result
  );
  return result;
}
