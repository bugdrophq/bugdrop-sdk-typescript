# V1 customer same-origin integration

This framework-neutral example connects `@bugdrop/browser` to `@bugdrop/server` through the
customer's backend. It is a local customer transport example, not a hosted service or widget
qualification. Mount `createV1Handler` at exactly `POST /api/bugdrop-capability/v1` on the
configured HTTPS application origin. The route accepts only `submissionId` and `payloadDigest`.

## Customer backend

```ts
import { createV1Handler } from './handler.js';

const handle = createV1Handler(
  {
    apiKey: process.env.BUGDROP_API_KEY,
    origin: 'https://your-app.example',
    // endpoint may be overridden for an approved staging or local target.
  },
  async (request) => {
    // Replace with the customer's real session, CSRF, authorization and rate checks.
    // Only an explicit true permits the exchange. Inspect headers; do not read/log body.
    return await verifySessionAndCsrfAndRateLimit(request);
  }
);
```

There is no default allow policy. The handler checks exact request URL and Origin before the
customer policy. The policy must verify the authenticated session and compare the browser's
`X-BugDrop-CSRF-Token` to the customer's server-side expected value. A browser-supplied header
alone is not authorization. For anonymous use, implement an explicit policy with equivalent
abuse and CSRF protection; never deploy a placeholder `() => true`.

Keep the API key only in server configuration. The handler forwards no cookies, CSRF token,
identity, repository selector or browser-supplied authority to BugDrop. It supplies configured
origin/environment and the two validated binding fields to the server SDK. The fixed response is
no-store JSON. All denials and upstream failures return the same redacted no-store HTTP 502 body.
There is no fallback, redirect following or retry. The surrounding HTTP adapter must preserve the
external URL and Origin without trusting forwarding headers, reject ambiguous HTTP framing, and
set connection/body-read/policy timeouts and concurrency limits. It must not cache or log route
bodies or capability responses.

## Browser

```ts
import { BugDrop } from '@bugdrop/browser';
import { createV1TokenProvider } from './transport.js';

BugDrop.init({
  applicationId: 'app_your_public_application_id',
  tokenProvider: createV1TokenProvider(() => readCurrentCustomerCsrfToken()),
});
```

Import only `transport.ts` into browser code. The CSRF source returns the customer's current
anti-CSRF token; it is distinct from the BugDrop API key. The transport sends one same-origin
credentialed POST with `redirect: 'error'`, `cache: 'no-store'`, and no referrer. It bounds request
and response bytes, accepts only the V1 capability envelope, and throws a fixed error on failure.
The browser SDK performs the final canonical lifetime check before passing the opaque token to
the hosted widget. Do not retry automatically after an ambiguous exchange.

Run `npx vitest run test/v1-backend*.test.ts` and `npm run validate`. The tests and packed
consumer check use a local capability fixture, not deployed issuer, ingress, delivery, real
session policy or hosted widget. Those require their own staging acceptance evidence.
