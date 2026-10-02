# V1 customer same-origin integration

This framework-neutral example connects `@bugdrop/browser` to `@bugdrop/server` through the
customer's backend. It is a local customer transport example, not a hosted service or widget
qualification. Mount `createV1Handler` at exactly `POST /api/bugdrop-capability/v1` on the
configured HTTPS application origin (HTTP only for canonical loopback origins, including
`.localhost`). The route accepts only `submissionId` and `payloadDigest`.

## Customer backend

```ts
import { createV1Handler } from './handler.js';

const handle = createV1Handler(
  {
    apiKey: process.env.BUGDROP_API_KEY,
    origin: 'https://your-app.example',
    // endpoint may be overridden for an approved staging or local target.
  },
  async (request, binding) => {
    // Replace with the customer's real session, CSRF, authorization and rate checks.
    // Atomically record submissionId -> payloadDigest, or reject a different digest.
    // Only an explicit true permits the exchange. Do not read/log the body.
    return await verifyCustomerPolicyAndBinding(request, binding);
  }
);
```

There is no default allow policy. The handler checks exact request URL and Origin before the
customer policy. The policy must verify the authenticated session and compare the browser's
`X-BugDrop-CSRF-Token` to the customer's server-side expected value. It receives a frozen parsed
binding before the issuer exchange. Within the customer's authorized scope, atomically and durably
insert `submissionId -> payloadDigest` if absent; if the ID exists, allow only the same digest and
reject a different one. Retain this check for the customer's relevant submission/replay lifetime.
The map and user/session identity stay in customer storage and never go to BugDrop. A
browser-supplied header alone is not authorization. For anonymous use, implement an explicit policy
with equivalent abuse and CSRF protection; never deploy a placeholder `() => true`.

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
anti-CSRF token; it is distinct from the BugDrop API key. The transport permits canonical HTTP
loopback origins for development and otherwise requires HTTPS. It sends one same-origin
credentialed POST with `redirect: 'error'`, `cache: 'no-store'`, and no referrer. It bounds request
and response bytes, accepts only the V1 capability envelope, and throws a fixed error on failure.
One eight-second deadline covers both fetch and body read; timeout aborts and settles even if the
underlying fetch or stream cancellation never completes. There is no retry.
The browser SDK performs the final canonical lifetime check before passing the opaque token to
the hosted widget. Do not retry automatically after an ambiguous exchange.

Run `npx vitest run test/v1-backend*.test.ts` and `npm run validate`. The tests and packed
consumer check use a local capability fixture, not deployed issuer, ingress, delivery, real
session policy or hosted widget. Those require their own staging acceptance evidence.

## Runnable loopback customer fixture

After `npm ci`, run:

```sh
npm run example:v1:loopback -- --state-dir /absolute/private/bugdrop-loopback-state
```

Open the printed `http://127.0.0.1:<port>/` URL and click **Request local capability**. The
page invokes the V1 browser transport, the local route checks a cookie-backed session and CSRF
token, then the server SDK calls an injected local issuer stub. No external issuer, widget,
ingress, or delivery endpoint is contacted. The server binds each `submissionId` to its
`payloadDigest` and session in the specified directory using a synced file and rejects a changed
digest or a second session. The directory is single-process locked; after an unclean exit, remove
`active.lock` only after verifying the fixture is stopped. Keep this directory private and do not
use it for production customer data.

The browser keeps an unfinished submission ID in tab session storage. After an ambiguous failure,
click again to explicitly retry the same binding; it never retries automatically. A successful
response clears the pending ID. The local issuer returns an opaque test token that cannot be used
as hosted acceptance evidence. This fixture's anonymous loopback session policy is for local
dogfood only; a deployed customer route still needs real customer authorization, durable storage,
rate limits, operational timeouts, and the HTTPS ingress controls described above.
