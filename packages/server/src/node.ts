import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { createCapabilityHandler, type CapabilityHandlerOptions } from './adapter.js';
import {
  adapterPath,
  canonicalOrigin,
  adapterFailure,
  disabledResponse,
} from './adapter-config.js';
import { failureReporter } from './adapter-diagnostics.js';

/** Mount before body parsers. Forwarded headers never select the authority or route. */
export function createNodeCapabilityHandler(options: CapabilityHandlerOptions) {
  const origin = canonicalOrigin(options.origin);
  const path = adapterPath(options.path);
  const handler = createCapabilityHandler(options);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const controller = new AbortController();
    const report = failureReporter(options.observeFailure);
    const abort = () => controller.abort();
    let responseClosed = false;
    const close = () => {
      responseClosed = true;
      abort();
    };
    req.once('aborted', abort);
    res.once('close', close);
    const write = async (response: Response) => {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (responseClosed || res.destroyed || res.writableEnded || res.socket?.destroyed) return;
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(bytes);
    };
    try {
      if (options.enabled !== true) {
        report({ phase: 'configuration', reason: 'disabled', issuerContacted: false });
        await write(disabledResponse());
        return;
      }
      const seen = new Set<string>();
      for (let index = 0; index < req.rawHeaders.length; index += 2) {
        const key = req.rawHeaders[index]!.toLowerCase();
        if (seen.has(key)) throw new Error();
        seen.add(key);
      }
      if (
        req.headers.host !== new URL(origin).host ||
        req.url !== path ||
        req.method !== 'POST' ||
        req.headers.origin !== origin ||
        req.headers['content-type'] !== 'application/json' ||
        req.headers['sec-fetch-site'] !== 'same-origin' ||
        req.headers['content-encoding'] !== undefined ||
        (req.headers['content-length'] !== undefined &&
          req.headers['transfer-encoding'] !== undefined)
      )
        throw new Error();
      if (req.destroyed || req.readableEnded || Readable.isDisturbed(req)) throw new Error();
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) throw new Error();
        if (value !== undefined) headers.set(key, value);
      }
      const request = new Request(`${origin}${path}`, {
        method: 'POST',
        headers,
        body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
        signal: controller.signal,
        ...({ duplex: 'half' } as object),
      });
      await write(await handler(request));
    } catch {
      report({ phase: 'node_envelope', reason: 'rejected', issuerContacted: false });
      await write(adapterFailure());
    } finally {
      req.off('aborted', abort);
      res.off('close', close);
    }
  };
}
