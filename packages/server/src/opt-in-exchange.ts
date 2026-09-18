import { performance } from 'node:perf_hooks';
import type { SubmissionCapability } from '../../contracts/src/index.js';
import { parseOptInJson } from './opt-in-json.js';
import { confirmation, type OptInRequest } from './opt-in-protocol.js';
import { requireValue } from './opt-in-values.js';
import { responseLength } from './opt-in-headers.js';
import type { OptInConfiguration } from './opt-in-config.js';

export class BugDropOptInError extends Error {
  readonly code: 'rejected_before_send' | 'exchange_unconfirmed';
  constructor(code: BugDropOptInError['code']) {
    super(
      code === 'rejected_before_send'
        ? 'BugDrop opt-in request rejected before send'
        : 'BugDrop opt-in exchange unconfirmed; do not retry or replace the request'
    );
    this.name = 'BugDropOptInError';
    this.code = code;
  }
}

function cancel(body: ReadableStream<Uint8Array> | null): void {
  try {
    void body?.cancel().catch(() => {});
  } catch {
    /* Untrusted transport cleanup. */
  }
}

interface Pending {
  config: OptInConfiguration;
  expected: OptInRequest;
  resolve: (value: SubmissionCapability) => void;
  reject: (error: BugDropOptInError) => void;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  chunks: Uint8Array[];
  bytes: number;
  length: number | undefined;
}

// Only this small cell is retained by an abort-ignoring promise. Clearing pending
// drops SDK references to intent, body, chunks and callbacks at the 8s seal (within
// the additional 5s cleanup allowance). Transport-owned copies cannot be recalled.
function lifecycle(pending: Pending | undefined) {
  const controller = new AbortController();
  const start = performance.now();
  const finish = (capability?: SubmissionCapability) => {
    const state = pending;
    if (!state) return;
    pending = undefined;
    clearTimeout(timer);
    if (!capability) {
      try {
        controller.abort();
      } catch {
        /* Custom transport listener. */
      }
      try {
        void state.reader?.cancel().catch(() => {});
      } catch {
        /* Cleanup is best effort. */
      }
      state.reject(new BugDropOptInError('exchange_unconfirmed'));
    } else state.resolve(capability);
    state.chunks.length = 0;
  };
  const expired = () => performance.now() - start >= 8000;
  const timer = setTimeout(() => finish(), 8000);
  const fail = () => finish();
  const read = () => {
    if (!pending || expired()) {
      finish();
      return;
    }
    try {
      void pending.reader!.read().then(chunk, fail);
    } catch {
      finish();
    }
  };
  const chunk = (part: Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>) => {
    if (!pending || expired()) {
      finish();
      return;
    }
    try {
      if (!part.done) {
        requireValue(part.value instanceof Uint8Array);
        pending.bytes += part.value.byteLength;
        requireValue(pending.bytes <= 65_536);
        if (part.value.byteLength > 0) pending.chunks.push(part.value.slice());
        read();
        return;
      }
      requireValue(pending.length === undefined || pending.bytes === pending.length);
      const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        Buffer.concat(pending.chunks)
      );
      const result = confirmation(parseOptInJson(raw), pending.expected, pending.config);
      finish(expired() ? undefined : result);
    } catch {
      finish();
    }
  };
  const received = (response: Response) => {
    if (!pending || expired()) {
      cancel(response.body);
      finish();
      return;
    }
    try {
      pending.length = responseLength(response);
      requireValue(response.body);
      pending.reader = response.body.getReader();
      read();
    } catch {
      cancel(response.body);
      finish();
    }
  };
  return { received, fail, signal: controller.signal };
}

export function exchange(
  config: OptInConfiguration,
  expected: OptInRequest
): Promise<SubmissionCapability> {
  return new Promise((resolve, reject) => {
    const flow = lifecycle({
      config,
      expected,
      resolve,
      reject,
      chunks: [],
      bytes: 0,
      length: undefined,
    });
    try {
      const init = {
        method: 'POST',
        body: expected.body,
        headers: expected.headers,
        redirect: 'error' as const,
        cache: 'no-store' as const,
        credentials: 'omit' as const,
        referrerPolicy: 'no-referrer' as const,
        signal: flow.signal,
      };
      const transport = config.fetch;
      const result = transport(config.endpoint, init);
      void Promise.resolve(result).then(flow.received, flow.fail).catch(flow.fail);
    } catch {
      flow.fail();
    }
  });
}
