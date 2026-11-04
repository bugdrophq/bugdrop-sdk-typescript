import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { createNodeCapabilityHandler } from '@bugdrop/server/node';
import { body, options, path, upstream } from './helpers/adapter-fixture.js';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function server(enabled = true, policy?: () => Promise<boolean>) {
  const fetch = upstream();
  const instance = createServer((req, res) => {
    void handler(req, res);
  });
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  cleanup.push(
    () =>
      new Promise<void>((r) => {
        instance.closeAllConnections();
        instance.close(() => r());
      })
  );
  const address = instance.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  const handler = createNodeCapabilityHandler(
    policy
      ? { ...options(fetch), origin, enabled, mode: 'customer-policy', policy }
      : { ...options(fetch), origin, enabled }
  );
  const send = (headers = {}, target = path) =>
    new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        origin + target,
        {
          method: 'POST',
          headers: {
            Origin: origin,
            'Content-Type': 'application/json',
            'Sec-Fetch-Site': 'same-origin',
            ...headers,
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode!));
        }
      );
      req.on('error', reject);
      req.end(body);
    });
  return { instance, origin, fetch, send, port: address.port };
}
it('uses raw native sockets and ignores forwarded authority selectors', async () => {
  const app = await server();
  expect(await app.send({ 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' })).toBe(
    200
  );
  expect(app.fetch).toHaveBeenCalledTimes(1);
  expect(await app.send({ Host: 'evil.example' })).toBe(502);
  expect(await app.send({}, path.slice(0, -1))).toBe(502);
  expect(await app.send({ 'Content-Encoding': 'identity' })).toBe(502);
  expect(app.fetch).toHaveBeenCalledTimes(1);
});
it('rejects duplicate raw headers even when Node would discard a duplicate', async () => {
  const app = await server();
  const socket = connect(app.port, '127.0.0.1');
  socket.setEncoding('utf8');
  let result = '';
  socket.on('data', (chunk) => {
    result += chunk;
  });
  socket.write(
    `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${app.port}\r\nOrigin: ${app.origin}\r\nOrigin: ${app.origin}\r\nContent-Type: application/json\r\nSec-Fetch-Site: same-origin\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
  );
  await once(socket, 'close');
  expect(result).toContain('502');
  expect(app.fetch).not.toHaveBeenCalled();
});
it('responds to oversized chunked input after cancelling its request reader', async () => {
  const app = await server();
  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(
      app.origin + path,
      {
        method: 'POST',
        agent: false,
        headers: {
          Origin: app.origin,
          'Content-Type': 'application/json',
          'Sec-Fetch-Site': 'same-origin',
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode!, body }));
      }
    );
    req.on('error', reject);
    req.setTimeout(1_000, () => {
      req.destroy(new Error('Missing rejection response'));
    });
    req.write('x'.repeat(1025));
    setTimeout(() => req.end(), 20);
  });
  expect(response.status).toBe(502);
  expect(response.body).toBe('{"error":"unable_to_authorize_bugdrop"}');
  expect(app.fetch).not.toHaveBeenCalled();
});
it('stays disabled before adaptation and cancels disconnect during policy', async () => {
  const disabled = await server(false);
  expect(await disabled.send()).toBe(404);
  expect(disabled.fetch).not.toHaveBeenCalled();
  let resolve!: (value: boolean) => void;
  const entered = vi.fn();
  const app = await server(true, () => {
    entered();
    return new Promise<boolean>((r) => {
      resolve = r;
    });
  });
  const req = httpRequest(app.origin + path, {
    method: 'POST',
    headers: {
      Origin: app.origin,
      'Content-Type': 'application/json',
      'Sec-Fetch-Site': 'same-origin',
    },
  });
  req.on('error', () => {});
  req.end(body);
  await vi.waitFor(() => expect(entered).toHaveBeenCalled());
  req.destroy();
  await new Promise((r) => setTimeout(r, 20));
  resolve(true);
  await new Promise((r) => setTimeout(r, 20));
  expect(app.fetch).not.toHaveBeenCalled();
});
