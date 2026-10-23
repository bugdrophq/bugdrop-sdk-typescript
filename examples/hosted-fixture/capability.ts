import { createV1Handler } from '../v1-backend/handler.js';
import { readBackendBinding } from './backend-binding.js';
import { callState } from './state-client.js';
import type { FixtureEnv, FixtureStub, FixtureExecutionContext } from './types.js';
function denied() {
  return new Response('{"error":"unable_to_authorize_bugdrop"}', {
    status: 502,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
export async function capability(
  request: Request,
  env: FixtureEnv,
  stub: FixtureStub,
  id: string | null,
  context?: FixtureExecutionContext
): Promise<Response> {
  if (!id) return denied();
  let lease: string | null = null;
  try {
    const binding = await readBackendBinding(request, env, id);
    if (!binding) return denied();
    const service = env.CAPABILITY_SERVICE;
    const handler = createV1Handler(
      {
        apiKey: binding.apiKey,
        origin: env.FIXTURE_ORIGIN,
        endpoint: env.BUGDROP_CAPABILITY_ENDPOINT,
        timeoutMs: 18_000,
        admission: 'managed-v1',
        ...(service
          ? {
              fetch: async (input, init) => {
                if (input !== new URL(env.BUGDROP_CAPABILITY_ENDPOINT).href)
                  throw new Error('Unexpected capability endpoint');
                return service.fetch(new Request(input, init));
              },
            }
          : {}),
      },
      async (incoming, binding) => {
        if (incoming.headers.get('Sec-Fetch-Site') !== 'same-origin') return false;
        const result = await callState(stub, '/authorize', {
          sessionId: id,
          csrf: incoming.headers.get('X-BugDrop-CSRF-Token'),
          ...binding,
        });
        if (typeof result?.lease !== 'string' || !/^[a-f0-9]{64}$/.test(result.lease)) return false;
        lease = result.lease;
        return true;
      }
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const inbound = new Request(request, { signal: controller.signal });
      return await Promise.race([
        handler(inbound),
        new Promise<Response>((resolve) =>
          controller.signal.addEventListener('abort', () => resolve(denied()), { once: true })
        ),
      ]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  } catch {
    return denied();
  } finally {
    if (lease) {
      const cleanup = callState(stub, '/finish', { sessionId: id, lease });
      context?.waitUntil(cleanup);
    }
  }
}
