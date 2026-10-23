import type { FixtureStub } from './types.js';
const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
export async function callState(
  stub: FixtureStub,
  path: string,
  body: object
): Promise<Record<string, unknown> | null> {
  try {
    const response = await stub.fetch(
      new Request(`https://fixture-state.internal${path}`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(1500),
      })
    );
    if (!response.ok) return null;
    const value: unknown = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
