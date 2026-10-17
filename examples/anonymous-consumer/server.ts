import { createV1Handler, type CustomerBinding, type V1BackendOptions } from './handler.js';

/** Explicit anonymous admission, with durable binding and rate limiting supplied server-side. */
export function capabilityEndpoint(
  options: V1BackendOptions & { enabled: boolean },
  admit: (binding: CustomerBinding, signal: AbortSignal) => Promise<boolean>
) {
  if (typeof admit !== 'function') throw new TypeError('Durable anonymous admission is required');
  const handler = createV1Handler(
    options,
    async (request, binding) =>
      request.headers.get('Sec-Fetch-Site') === 'same-origin' &&
      (await admit(binding, request.signal))
  );
  return (request: Request): Promise<Response> =>
    options.enabled
      ? handler(request)
      : Promise.resolve(
          new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
        );
}
