# Next.js capability route

This App Router example keeps the BugDrop API key on the server, requires an exact request origin,
applies a customer-owned access hook, and prevents capability caching. Replace the two placeholder
helpers with the application's real policy. An application that permits anonymous reporters may omit
the session requirement, but it still needs suitable application/network abuse controls.

```ts
import { BugDrop } from '@bugdrop/server';

const applicationOrigin = requireServerSetting('APPLICATION_ORIGIN');
const bugdrop = new BugDrop({ apiKey: process.env.BUGDROP_API_KEY });

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== applicationOrigin) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  await requireCustomerAccess(request);

  try {
    const { submissionId, payloadDigest } = await request.json();
    const capability = await bugdrop.createSubmissionToken({
      submissionId,
      payloadDigest,
      origin: applicationOrigin,
      environment: 'production',
    });
    return Response.json(capability, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json(
      { error: 'unable_to_authorize_bugdrop' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
```

Configure a small request-body limit at the deployment boundary. Do not log the request body or the
capability response. Cookie-authenticated routes must also use the application's standard CSRF
defense inside `requireCustomerAccess`.
