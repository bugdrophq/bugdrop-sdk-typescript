import type { FixtureSession, FixtureStateContext, FixtureStorage } from './types.js';

const SESSION_MS = 30 * 60_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 8;
const LEASE_MS = 9_000;
const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

type Binding = { sessionId: string; payloadDigest: string };
type Counter = { windowStart: number; attempts: number };

function token(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function response(value: object, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

async function key(submissionId: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(submissionId));
  return `binding:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export class FixtureState {
  constructor(private readonly context: FixtureStateContext) {}

  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== 'POST' || request.headers.get('Content-Type') !== 'application/json')
        return response({ ok: false }, 403);
      const value: unknown = await request.json();
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return response({ ok: false }, 403);
      const body = value as Record<string, unknown>;
      const action = new URL(request.url).pathname;
      if (action === '/login-allow' && Object.keys(body).length === 0) {
        const allowed = await this.context.storage.transaction(async (tx) => {
          const now = Date.now();
          const previous = await tx.get<Counter>('login-rate');
          const withinWindow = previous && now - previous.windowStart < RATE_WINDOW_MS;
          if (withinWindow && previous.attempts >= RATE_LIMIT) return false;
          await tx.put('login-rate', {
            windowStart: withinWindow ? previous.windowStart : now,
            attempts: withinWindow ? previous.attempts + 1 : 1,
          } satisfies Counter);
          return true;
        });
        return allowed ? response({ allowed: true }) : response({ ok: false }, 403);
      }
      if (action === '/create' && Object.keys(body).length === 0) {
        const id = token();
        const csrf = token();
        await this.context.storage.put(`session:${id}`, {
          csrf,
          expiresAt: Date.now() + SESSION_MS,
          windowStart: Date.now(),
          requests: 0,
        } satisfies FixtureSession);
        return response({ id, csrf });
      }
      if (typeof body.sessionId !== 'string' || !/^[a-f0-9]{64}$/.test(body.sessionId))
        return response({ ok: false }, 403);
      if (action === '/session' && Object.keys(body).length === 1) {
        const session = await this.context.storage.get<FixtureSession>(`session:${body.sessionId}`);
        if (!session || session.expiresAt <= Date.now()) return response({ ok: false }, 403);
        return response({ csrf: session.csrf });
      }
      if (action === '/authorize') return await this.authorize(body);
      if (action === '/finish') return await this.finish(body);
    } catch {
      // The outer worker also rejects every failed state operation.
    }
    return response({ ok: false }, 403);
  }

  private async authorize(body: Record<string, unknown>): Promise<Response> {
    if (
      Object.keys(body).length !== 4 ||
      typeof body.sessionId !== 'string' ||
      typeof body.csrf !== 'string' ||
      typeof body.submissionId !== 'string' ||
      typeof body.payloadDigest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.csrf) ||
      !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(body.payloadDigest)
    )
      return response({ ok: false }, 403);
    const { sessionId, csrf, submissionId, payloadDigest } = body as {
      sessionId: string;
      csrf: string;
      submissionId: string;
      payloadDigest: string;
    };
    const bindingKey = await key(submissionId);
    const result = await this.context.storage.transaction(async (tx) => {
      const sessionKey = `session:${sessionId}`;
      const session = await tx.get<FixtureSession>(sessionKey);
      const now = Date.now();
      if (!session || session.expiresAt <= now || session.csrf !== csrf) return null;
      const withinWindow = now - session.windowStart < RATE_WINDOW_MS;
      if (withinWindow && session.requests >= RATE_LIMIT) return null;
      if (session.active && session.active.until > now) return null;
      const prior = await tx.get<Binding>(bindingKey);
      if (prior && (prior.sessionId !== sessionId || prior.payloadDigest !== payloadDigest))
        return null;
      const lease = token();
      if (!prior)
        await tx.put(bindingKey, {
          sessionId,
          payloadDigest,
        } satisfies Binding);
      await tx.put(sessionKey, {
        ...session,
        windowStart: withinWindow ? session.windowStart : now,
        requests: withinWindow ? session.requests + 1 : 1,
        active: { token: lease, until: now + LEASE_MS },
      } satisfies FixtureSession);
      return lease;
    });
    return result ? response({ lease: result }) : response({ ok: false }, 403);
  }

  private async finish(body: Record<string, unknown>): Promise<Response> {
    if (
      Object.keys(body).length !== 2 ||
      typeof body.lease !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.lease)
    )
      return response({ ok: false }, 403);
    await this.context.storage.transaction(async (tx: FixtureStorage) => {
      const sessionKey = `session:${body.sessionId}`;
      const session = await tx.get<FixtureSession>(sessionKey);
      if (session && session.active?.token === body.lease) {
        const { active: _active, ...rest } = session;
        await tx.put(sessionKey, rest);
      }
    });
    return response({ ok: true });
  }
}
