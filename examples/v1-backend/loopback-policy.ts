import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { CustomerBinding, CustomerPolicy } from './handler.js';

type Session = { id: string; csrf: string };
type Record = { sessionId: string; submissionId: string; payloadDigest: string };

function key(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function durableWrite(directory: string, name: string, value: unknown): Promise<void> {
  const temporary = join(directory, `.pending-${randomBytes(16).toString('hex')}`);
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, join(directory, name));
    const folder = await open(directory, 'r');
    try {
      await folder.sync();
    } finally {
      await folder.close();
    }
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function createLoopbackPolicy(stateDirectory: string) {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const details = await stat(stateDirectory);
  if (!details.isDirectory() || (details.mode & 0o077) !== 0)
    throw new Error('Loopback state directory must be private');
  const lock = await open(join(stateDirectory, 'active.lock'), 'wx', 0o600);
  const sessions = join(stateDirectory, 'sessions');
  const bindings = join(stateDirectory, 'bindings');
  try {
    await mkdir(sessions, { recursive: true, mode: 0o700 });
    await mkdir(bindings, { recursive: true, mode: 0o700 });
  } catch (error) {
    await lock.close();
    await rm(join(stateDirectory, 'active.lock'), { force: true });
    throw error;
  }

  async function session(cookie: string | null): Promise<Session | null> {
    const matches = cookie
      ?.split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith('bd_loopback_session='));
    if (!matches || matches.length !== 1) return null;
    const match = matches[0];
    if (!match) return null;
    const id = match.slice('bd_loopback_session='.length);
    if (!/^[a-f0-9]{64}$/.test(id)) return null;
    try {
      const saved = JSON.parse(await readFile(join(sessions, id), 'utf8')) as Session;
      return saved.id === id && /^[a-f0-9]{64}$/.test(saved.csrf) ? saved : null;
    } catch {
      return null;
    }
  }

  async function issue(cookie: string | null): Promise<Session> {
    const existing = await session(cookie);
    if (existing) return existing;
    const created = { id: randomBytes(32).toString('hex'), csrf: randomBytes(32).toString('hex') };
    await durableWrite(sessions, created.id, created);
    return created;
  }

  let gate = Promise.resolve();
  const policy: CustomerPolicy = async (request: Request, binding: CustomerBinding) => {
    const active = await session(request.headers.get('Cookie'));
    if (!active || !equal(request.headers.get('X-BugDrop-CSRF-Token') ?? '', active.csrf))
      return false;
    const previous = gate;
    let release!: () => void;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const path = join(bindings, key(binding.submissionId));
      try {
        const saved = JSON.parse(await readFile(path, 'utf8')) as Record;
        return (
          saved.submissionId === binding.submissionId &&
          saved.sessionId === active.id &&
          saved.payloadDigest === binding.payloadDigest
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
      }
      await durableWrite(bindings, key(binding.submissionId), {
        sessionId: active.id,
        submissionId: binding.submissionId,
        payloadDigest: binding.payloadDigest,
      } satisfies Record);
      return true;
    } finally {
      release();
    }
  };

  return {
    issue,
    policy,
    close: async () => {
      await lock.close();
      await rm(join(stateDirectory, 'active.lock'), { force: true });
    },
  };
}
