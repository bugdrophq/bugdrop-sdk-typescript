/** Own the upstream reader so cancellation works while the SDK reads the forwarded body. */
export function leaseIssuerResponse(response: Response, signal: AbortSignal) {
  if (!response.body) return { response, close: () => {} };
  const reader = response.body.getReader();
  let ended = false;
  let output: ReadableStreamDefaultController<Uint8Array>;
  const release = () => {
    try {
      reader.releaseLock();
    } catch {
      /* A pending read also releases in pull's finally. */
    }
  };
  const close = () => {
    if (ended) return;
    ended = true;
    signal.removeEventListener('abort', close);
    try {
      output.error(new Error('Capability response closed'));
    } catch {
      /* Already closed. */
    }
    // Neither a rejecting nor an abort-ignoring source may delay handler settlement.
    void reader.cancel().catch(() => {});
    release();
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      output = controller;
      signal.addEventListener('abort', close, { once: true });
      if (signal.aborted) close();
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (ended) return;
        if (chunk.done) {
          ended = true;
          signal.removeEventListener('abort', close);
          controller.close();
        } else controller.enqueue(chunk.value);
      } catch {
        close();
      } finally {
        if (ended) release();
      }
    },
    cancel: close,
  });
  try {
    return {
      response: new Response(body, { status: response.status, headers: response.headers }),
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
