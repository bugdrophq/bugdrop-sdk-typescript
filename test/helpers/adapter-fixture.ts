import { vi } from 'vitest';
import credential from '../../packages/contracts/fixtures/api-key-credential.v1.json';
import fixture from '../../packages/contracts/fixtures/submission-binding.v1.json';
import type { CapabilityHandlerOptions } from '../../packages/server/src/adapter.js';
export const origin = 'https://app.example.com';
export const path = '/api/bugdrop-capability/v1/';
export const binding = fixture.bound;
export const body = JSON.stringify(binding);
export const capability = () => ({
  schemaVersion: 1,
  token: 'fixture-token',
  expiresAt: new Date(Date.now() + 240_000).toISOString(),
});
export const upstream = () =>
  vi.fn<typeof fetch>(async () => Response.json({ ...capability(), admission: 'managed-v1' }));
export const options = (fetch: typeof globalThis.fetch = upstream()): CapabilityHandlerOptions => ({
  enabled: true,
  mode: 'anonymous',
  apiKey: credential.apiKey,
  origin,
  fetch,
});
export const request = (content: BodyInit = body, init: RequestInit = {}, url = origin + path) =>
  new Request(url, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'Sec-Fetch-Site': 'same-origin',
    },
    body: content,
    ...init,
  });
export async function denied(response: Response) {
  const { expect } = await import('vitest');
  expect(response.status).toBe(502);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  expect(await response.text()).toBe('{"error":"unable_to_authorize_bugdrop"}');
}
