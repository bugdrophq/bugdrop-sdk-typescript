import { createServer } from 'node:http';
import { once } from 'node:events';

// This deliberately does not implement signing or ingress. Real-service conformance is separate.
export async function startTransportFixture() {
  const requests = [];
  let status = 200;
  let payload;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ path: request.url, headers: request.headers, body });
    response.writeHead(status, { 'Content-Type': 'application/json', Location: '/current-public' });
    response.end(JSON.stringify(payload));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    endpoint: `http://127.0.0.1:${server.address().port}/v1/submission-capabilities`,
    requests,
    respond(nextPayload, nextStatus = 200) {
      payload = nextPayload;
      status = nextStatus;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}
