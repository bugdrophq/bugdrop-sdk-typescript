import { BugDrop, type BugDropServerOptions } from './index.js';
import {
  canonicalOrigin,
  adapterPath,
  adapterFailure,
  disabledResponse,
} from './adapter-config.js';
import { parseBinding, readBindingBody } from './adapter-body.js';
import { leaseIssuerResponse } from './adapter-response.js';
import { failureReporter, type FailureObserver, type FailurePhase } from './adapter-diagnostics.js';
export type { FailureDiagnostic, FailureObserver } from './adapter-diagnostics.js';

export type CustomerBinding = Readonly<{ submissionId: string; payloadDigest: string }>;
export type CustomerPolicy = (
  request: Request,
  binding: CustomerBinding
) => boolean | Promise<boolean>;
type CommonOptions = Omit<BugDropServerOptions, 'admission' | 'timeoutMs'> & {
  enabled?: boolean;
  origin: string;
  path?: string;
  environment?: string;
  observeFailure?: FailureObserver;
};
export type CapabilityHandlerOptions = CommonOptions &
  ({ mode: 'anonymous'; policy?: never } | { mode: 'customer-policy'; policy: CustomerPolicy });
/** Node20+ Web interface; enabled must be exactly true. No client is created while disabled. */
export function createCapabilityHandler(options: CapabilityHandlerOptions) {
  const origin = canonicalOrigin(options.origin);
  const path = adapterPath(options.path);
  if (
    options.mode !== 'anonymous' &&
    (options.mode !== 'customer-policy' || typeof options.policy !== 'function')
  ) {
    throw new TypeError('Explicit anonymous mode or customer-policy with a policy is required');
  }
  return async (request: Request): Promise<Response> => {
    const report = failureReporter(options.observeFailure);
    if (options.enabled !== true) {
      report({ phase: 'configuration', reason: 'disabled', issuerContacted: false });
      return disabledResponse();
    }
    const controller = new AbortController();
    let issuerContacted = false;
    let httpStatus: number | undefined;
    let phase: FailurePhase = 'node_envelope';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closeIssuerResponse: (() => void) | undefined;
    let abort: () => void = () => {};
    const ended = new Promise<Response>((resolve) => {
      const end = (cancelled: boolean) => {
        if (controller.signal.aborted) return;
        controller.abort();
        report({
          phase: cancelled ? 'cancelled' : 'deadline',
          reason: cancelled ? 'aborted' : 'expired',
          issuerContacted,
          ...(httpStatus === undefined ? {} : { httpStatus }),
        });
        resolve(adapterFailure());
      };
      abort = () => end(true);
      timer = setTimeout(() => end(false), 18_000);
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort();
    });
    const check = () => {
      if (controller.signal.aborted) throw new Error();
    };
    const exchange = async () => {
      try {
        check();
        if (
          request.method !== 'POST' ||
          request.url !== `${origin}${path}` ||
          request.headers.get('Origin') !== origin ||
          request.headers.get('Content-Type') !== 'application/json' ||
          request.headers.get('Sec-Fetch-Site') !== 'same-origin' ||
          request.headers.has('Content-Encoding')
        )
          throw new Error();
        const bounded = new Request(request, { signal: controller.signal });
        phase = 'body';
        const body = await readBindingBody(bounded);
        check();
        phase = 'binding';
        const binding = Object.freeze(parseBinding(body));
        phase = 'policy';
        if (options.mode === 'customer-policy' && (await options.policy(bounded, binding)) !== true)
          throw new Error();
        check();
        phase = 'sdk_init';
        const transport = options.fetch ?? globalThis.fetch;
        const client = new BugDrop({
          apiKey: options.apiKey,
          admission: 'managed-v1',
          endpoint: options.endpoint ?? 'https://managed.bugdrop.dev/v1/submission-capabilities',
          timeoutMs: 18_000,
          fetch: async (...args) => {
            check(); // Authentication can settle after the overall deadline. Never contact the issuer then.
            issuerContacted = true;
            const response = await transport(...args);
            if (controller.signal.aborted) {
              void response.body?.cancel().catch(() => {});
              check();
            }
            httpStatus = response.status;
            const lease = leaseIssuerResponse(response, controller.signal);
            closeIssuerResponse = lease.close;
            return lease.response;
          },
        });
        check();
        phase = 'issuer_exchange';
        const capability = await client.createSubmissionToken({
          ...binding,
          origin,
          environment: options.environment ?? 'production',
          signal: controller.signal,
        });
        check();
        return new Response(JSON.stringify(capability), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      } catch {
        report({
          phase: controller.signal.aborted ? 'cancelled' : phase,
          reason: controller.signal.aborted ? 'aborted' : 'failed',
          issuerContacted,
          ...(httpStatus === undefined ? {} : { httpStatus }),
        });
        if (!request.body?.locked) void request.body?.cancel().catch(() => {});
        return adapterFailure();
      }
    };
    try {
      return await Promise.race([exchange(), ended]);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
      closeIssuerResponse?.();
    }
  };
}
