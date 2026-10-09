import { createV1Handler } from '../v1-backend/handler.js';
import { FixtureState } from './state.js';
import type { FixtureEnv, FixtureExecutionContext, FixtureStub } from './types.js';

export { FixtureState };

const ROUTE = '/api/bugdrop-capability/v1';
const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const COOKIE = '__Host-bd_fixture_sid';

function denied(): Response {
  return new Response('{"error":"unable_to_authorize_bugdrop"}', {
    status: 502,
    headers: JSON_HEADERS,
  });
}

function unavailable(): Response {
  return new Response('Fixture unavailable', {
    status: 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function safeConfig(env: FixtureEnv): boolean {
  try {
    if (env.FIXTURE_ENABLED !== 'true') return false;
    const origin = new URL(env.FIXTURE_ORIGIN);
    const widget = new URL(env.WIDGET_URL);
    const issuer = new URL(env.BUGDROP_CAPABILITY_ENDPOINT);
    return (
      origin.protocol === 'https:' &&
      origin.origin === env.FIXTURE_ORIGIN &&
      !origin.hostname.endsWith('.') &&
      widget.protocol === 'https:' &&
      !widget.username &&
      !widget.password &&
      !widget.search &&
      !widget.hash &&
      issuer.protocol === 'https:' &&
      !issuer.username &&
      !issuer.password &&
      !issuer.search &&
      !issuer.hash &&
      typeof env.APPLICATION_ID === 'string' &&
      /^[\x21-\x7e]{3,200}$/.test(env.APPLICATION_ID) &&
      typeof env.OPERATOR_PASSWORD === 'string' &&
      env.OPERATOR_PASSWORD.length >= 32 &&
      typeof env.BUGDROP_API_KEY === 'string' &&
      env.BUGDROP_API_KEY.length > 0 &&
      typeof env.FIXTURE_STATE?.get === 'function' &&
      typeof env.ASSETS?.fetch === 'function'
    );
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&#39;');
}

function page(html: string, widgetUrl: string): Response {
  const widgetOrigin = new URL(widgetUrl).origin;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; script-src 'self' ${widgetOrigin}; connect-src 'self' https://*.bugdrop.dev; style-src 'unsafe-inline'; img-src https: data:; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'`,
    },
  });
}

function sessionId(cookie: string | null): string | null {
  const values = cookie
    ?.split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${COOKIE}=`));
  if (!values || values.length !== 1) return null;
  const value = values[0]?.slice(COOKIE.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

async function callState(
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

async function readLogin(request: Request): Promise<string | null> {
  if (
    request.headers.get('Content-Type') !== 'application/x-www-form-urlencoded' ||
    request.headers.has('Content-Encoding')
  )
    return null;
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > 1024)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => {});
      resolve(null);
    }, 2_000);
  });
  const parse = async (): Promise<string | null> => {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1024) return null;
      chunks.push(chunk.value);
    }
    if (timedOut || (length !== null && Number(length) !== size)) return null;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const fields = new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return Array.from(fields.keys()).length === 1 ? fields.get('password') : null;
  };
  try {
    return await Promise.race([parse(), deadline]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    try {
      reader.releaseLock();
    } catch {
      /* A timed-out read may still be pending. */
    }
  }
}

async function equalSecret(candidate: string | null, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(candidate ?? '')),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let diff = candidate === null ? 1 : 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index]! ^ b[index]!;
  return diff === 0;
}

async function capability(
  request: Request,
  env: FixtureEnv,
  stub: FixtureStub,
  id: string | null,
  context?: FixtureExecutionContext
): Promise<Response> {
  if (!id) return denied();
  let lease: string | null = null;
  try {
    const handler = createV1Handler(
      {
        apiKey: env.BUGDROP_API_KEY,
        origin: env.FIXTURE_ORIGIN,
        endpoint: env.BUGDROP_CAPABILITY_ENDPOINT,
        timeoutMs: 5_000,
      },
      async (incoming, binding) => {
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
    const timer = setTimeout(() => controller.abort(), 8_000);
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

export default {
  async fetch(
    request: Request,
    env: FixtureEnv,
    context?: FixtureExecutionContext
  ): Promise<Response> {
    if (!safeConfig(env)) return unavailable();
    const url = new URL(request.url);
    if (url.origin !== env.FIXTURE_ORIGIN || url.search || url.hash) return denied();
    const stub = env.FIXTURE_STATE.get(env.FIXTURE_STATE.idFromName('global-v1'));
    const id = sessionId(request.headers.get('Cookie'));
    if (request.method === 'POST' && url.pathname === ROUTE) {
      return capability(request, env, stub, id, context);
    }
    if (request.method === 'POST' && url.pathname === '/login') {
      if (request.headers.get('Origin') !== env.FIXTURE_ORIGIN) return denied();
      const allowed = await callState(stub, '/login-allow', {});
      if (allowed?.allowed !== true) return denied();
      const password = await readLogin(request);
      if (!(await equalSecret(password, env.OPERATOR_PASSWORD))) return denied();
      const created = await callState(stub, '/create', {});
      if (typeof created?.id !== 'string' || !/^[a-f0-9]{64}$/.test(created.id)) return denied();
      return new Response(null, {
        status: 303,
        headers: {
          Location: '/',
          'Cache-Control': 'no-store',
          'Set-Cookie': `${COOKIE}=${created.id}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`,
        },
      });
    }
    if (request.method === 'GET' && url.pathname === '/') {
      const session = id ? await callState(stub, '/session', { sessionId: id }) : null;
      if (typeof session?.csrf === 'string') {
        return page(
          `<!doctype html><meta charset="utf-8"><title>BugDrop SDK fixture</title>
<h1>BugDrop SDK staging fixture</h1><p>Operator session active.</p>
<button id="open" data-csrf="${escapeHtml(session.csrf)}" data-application="${escapeHtml(env.APPLICATION_ID)}" data-widget="${escapeHtml(env.WIDGET_URL)}" disabled>Open BugDrop</button>
<p id="status" role="status"></p><script src="/fixture.js"></script>`,
          env.WIDGET_URL
        );
      }
      return page(
        `<!doctype html><meta charset="utf-8"><title>BugDrop SDK fixture login</title>
<h1>Operator sign in</h1><form method="post" action="/login"><label>Password <input name="password" type="password" required autocomplete="current-password"></label><button>Sign in</button></form>`,
        env.WIDGET_URL
      );
    }
    if (request.method === 'GET' && url.pathname === '/fixture.js' && id) {
      const session = await callState(stub, '/session', { sessionId: id });
      if (typeof session?.csrf !== 'string') return denied();
      const asset = await env.ASSETS.fetch(request);
      if (!asset.ok) return unavailable();
      return new Response(asset.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    return denied();
  },
};
