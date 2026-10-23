import type { FixtureEnv } from './types.js';

const COOKIE = '__Host-bd_fixture_backend';
type Binding = { applicationId: string; apiKey: string; expiresAt: number };
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 2048)
    throw new Error('Invalid backend binding');
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
    c.charCodeAt(0)
  );
  if (encode(bytes) !== value) throw new Error('Invalid backend binding');
  return bytes;
}
const valid = (value: unknown): value is Binding => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).sort().join() === 'apiKey,applicationId,expiresAt' &&
    typeof v.applicationId === 'string' &&
    /^[A-Za-z0-9_-]{3,200}$/.test(v.applicationId) &&
    typeof v.apiKey === 'string' &&
    validApiKey(v.apiKey) &&
    Number.isSafeInteger(v.expiresAt) &&
    Number(v.expiresAt) > Date.now() &&
    Number(v.expiresAt) <= Date.now() + 1800000
  );
};
function validApiKey(value: string) {
  try {
    const [prefix, id, root, extra] = value.split('.');
    return (
      prefix === 'bd_api_v1' &&
      extra === undefined &&
      typeof id === 'string' &&
      typeof root === 'string' &&
      decode(id).length === 16 &&
      decode(root).length === 32
    );
  } catch {
    return false;
  }
}
async function key(env: FixtureEnv) {
  const material = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`fixture-backend.v1\n${env.FIXTURE_ORIGIN}\n${env.OPERATOR_PASSWORD}`)
  );
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}
const aad = (env: FixtureEnv, session: string) =>
  new TextEncoder().encode(`fixture-backend.v1\n${env.FIXTURE_ORIGIN}\n${session}`);

/** Fixture only: encrypted, session-bound HttpOnly custody; never a browser SDK option. */
export async function readBackendBinding(
  request: Request,
  env: FixtureEnv,
  session: string | null
): Promise<Binding | null> {
  if (env.SELF_SERVICE_BINDING !== '1')
    return {
      applicationId: env.APPLICATION_ID,
      apiKey: env.BUGDROP_API_KEY,
      expiresAt: Date.now() + 1,
    };
  if (!session) return null;
  try {
    const values = (request.headers.get('cookie') ?? '')
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.startsWith(`${COOKIE}=`));
    if (values.length !== 1) return null;
    const bytes = decode(values[0]!.slice(COOKIE.length + 1));
    const clear = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: aad(env, session) },
      await key(env),
      bytes.slice(12)
    );
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(clear));
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}

export async function saveBackendBinding(
  request: Request,
  env: FixtureEnv,
  session: string | null,
  csrf: string | undefined
): Promise<Response> {
  const denied = () =>
    new Response('Backend connection is unavailable.', {
      status: 403,
      headers: { 'Cache-Control': 'no-store' },
    });
  if (
    env.SELF_SERVICE_BINDING !== '1' ||
    !session ||
    !csrf ||
    request.headers.get('Origin') !== env.FIXTURE_ORIGIN ||
    request.headers.get('Content-Type') !== 'application/x-www-form-urlencoded' ||
    request.headers.has('Content-Encoding')
  )
    return denied();
  const reader = request.body?.getReader();
  if (!reader) return denied();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const bytes = await Promise.race([
      (async () => {
        let size = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > 2048) throw new Error('Too large');
          chunks.push(next.value);
        }
        const result = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        return result;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void reader.cancel().catch(() => {});
          reject(new Error('Deadline'));
        }, 2000);
      }),
    ]);
    const form = new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (
      [...form.keys()].sort().join() !== 'api_key,application_id,csrf' ||
      form.get('csrf') !== csrf
    )
      return denied();
    const binding = {
      applicationId: form.get('application_id'),
      apiKey: form.get('api_key'),
      expiresAt: Date.now() + 1800000,
    };
    if (!valid(binding)) return denied();
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: aad(env, session) },
        await key(env),
        new TextEncoder().encode(JSON.stringify(binding))
      )
    );
    const value = new Uint8Array(nonce.length + encrypted.length);
    value.set(nonce);
    value.set(encrypted, nonce.length);
    return new Response(null, {
      status: 303,
      headers: {
        Location: '/',
        'Cache-Control': 'no-store',
        'Set-Cookie': `${COOKIE}=${encode(value)}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`,
      },
    });
  } catch {
    return denied();
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
