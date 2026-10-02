import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createV1Handler } from './handler.js';
import { createLoopbackPolicy } from './loopback-policy.js';

const DENIED = '{"error":"unable_to_authorize_bugdrop"}';
const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };

function deny(response: ServerResponse): void {
  response.writeHead(502, NO_STORE).end(DENIED);
}

async function body(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024) throw new Error('body limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function safeFraming(request: IncomingMessage): boolean {
  const names = request.rawHeaders.filter((_value, index) => index % 2 === 0);
  const count = (name: string) =>
    names.filter((candidate) => candidate.toLowerCase() === name).length;
  return count('host') === 1 && count('content-length') <= 1 && count('transfer-encoding') === 0;
}

export async function startLoopback(stateDirectory: string, browserScript: string) {
  const storage = await createLoopbackPolicy(stateDirectory);
  let origin = '';
  let exchanges = 0;
  const apiKey = `bd_api_v1.${randomBytes(16).toString('base64url')}.${randomBytes(32).toString('base64url')}`;
  const issuer: typeof fetch = async (target, init) => {
    if (target !== `${origin}/__local_issuer` || init?.method !== 'POST')
      return new Response(null, { status: 503 });
    const authorization = new Headers(init.headers).get('Authorization');
    if (!authorization?.startsWith('Bearer bd_auth_v1.'))
      return new Response(null, { status: 503 });
    exchanges += 1;
    return Response.json({
      schemaVersion: 1,
      token: `local-fixture-${randomBytes(16).toString('hex')}`,
      expiresAt: new Date(Date.now() + 240_000).toISOString(),
    });
  };
  const server = createServer(async (request, response) => {
    request.setTimeout(8000, () => request.destroy());
    if (!safeFraming(request) || request.headers.host !== new URL(origin).host) {
      deny(response);
      return;
    }
    if (request.method === 'GET' && request.url === '/') {
      const active = await storage.issue(request.headers.cookie ?? null);
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': `bd_loopback_session=${active.id}; HttpOnly; SameSite=Strict; Path=/`,
        'Content-Security-Policy':
          "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'",
      });
      response.end(`<!doctype html><meta charset="utf-8"><title>BugDrop V1 loopback fixture</title>
<h1>BugDrop V1 local customer fixture</h1><p>Local mock capability only. No hosted submission.</p>
<button id="exchange" data-csrf="${active.csrf}">Request local capability</button>
<pre id="result" aria-live="polite"></pre><script src="/fixture.js"></script>`);
      return;
    }
    if (request.method === 'GET' && request.url === '/fixture.js') {
      response
        .writeHead(200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        .end(browserScript);
      return;
    }
    if (request.method !== 'POST' || request.url !== '/api/bugdrop-capability/v1') {
      deny(response);
      return;
    }
    try {
      const bytes = await body(request);
      const handler = createV1Handler(
        { apiKey, origin, endpoint: `${origin}/__local_issuer`, fetch: issuer },
        storage.policy
      );
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers.set(name, value);
      }
      const result = await handler(
        new Request(`${origin}${request.url}`, { method: 'POST', headers, body: bytes })
      );
      response
        .writeHead(result.status, {
          'Content-Type': result.headers.get('Content-Type') ?? 'application/json',
          'Cache-Control': result.headers.get('Cache-Control') ?? 'no-store',
        })
        .end(await result.text());
    } catch {
      deny(response);
    }
  });
  server.maxConnections = 16;
  server.headersTimeout = 5000;
  server.requestTimeout = 8000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    await storage.close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('loopback address missing');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    exchanges: () => exchanges,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
      await storage.close();
    },
  };
}
