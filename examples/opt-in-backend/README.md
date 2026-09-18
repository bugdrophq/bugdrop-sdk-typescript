# V2 opt-in reference backend

This framework-neutral example connects the opt-in browser SDK to the opt-in server SDK using
WHATWG `Request` and `Response`. Copy the handler into the customer's server and the transport
into the customer's browser application. Mount the handler at exactly
`POST /api/bugdrop-capability/v2` on the configured HTTPS application origin.

## Server setup

```ts
import { createOptInHandler } from './handler.js';
import type { BugDropOptInOptions } from '@bugdrop/server/opt-in';

// Load the complete trusted configuration described in @bugdrop/server's README:
// V2 credential, application/scope, canonical origin/issuer endpoint, catalog and confirmation keys.
declare const serverConfig: BugDropOptInOptions;

// Implement this using the customer's access, CSRF and rate-limit systems.
// Inspect cookies/headers locally; do not consume or log the request body.
declare function customerPolicy(request: Request): Promise<boolean>;

export const handleCapabilityRequest = createOptInHandler(serverConfig, customerPolicy);
```

There is no default allow policy. A missing policy fails startup; only an explicit `true` allows
an exchange. For cookie-authenticated applications, the hook must verify the session and enforce
the application's CSRF defense as well as rate limits. Exact Origin checking is an additional
check. If your CSRF mechanism requires a token header, add a narrowly defined local header to
the browser adapter and verify it in the hook; never forward it to the issuer. Anonymous access
also needs an explicit customer policy. Do not deploy a placeholder that always returns `true`.

Configure the HTTP adapter/proxy with header, connection, body-read and policy time limits,
concurrency limits, and an abort signal connected to client disconnects. The example bounds body
bytes; it does not implement the customer's connection scheduler, session system or rate limiter.
The policy hook must not read the body or start background exchanges. Pass a genuine WHATWG
Request; adapters must reject ambiguous raw HTTP framing and preserve the external request URL
and Origin. Do not reconstruct authority from untrusted forwarding headers.

The handler requires exact `Content-Type: application/json`, exact configured Origin, the fixed
URL, and no Content-Encoding. It reads at most 2,048 bytes into its buffer and rejects oversized
chunks, invalid UTF-8, duplicate decoded member names, extra fields and invalid binding/metadata.
An optional Content-Length must be canonical and match actual bytes. JSON whitespace is allowed.
The only accepted body is:

```json
{
  "binding": {
    "submissionId": "opaque report identifier",
    "payloadDigest": "canonical base64url SHA-256 digest"
  },
  "metadata": { "metadataVersion": 1, "browserSdkVersion": "0.1.0" }
}
```

P1 validates binding and metadata scalar values before any issuer request. Application, scope,
origin, credentials, catalog and confirmation keys come solely from the startup configuration.
The policy can inspect local cookies and request headers, but the handler forwards only binding
and metadata to P1. Cookies, user identity, User-Agent, Referer and IP headers never enter the
issuer exchange. No request or capability is logged. Disable body/header capture in surrounding
middleware, tracing, reverse proxies and error reporters as appropriate for these secrets.

Success is a no-store JSON V1 capability envelope returned only after P1 verifies the V2 issuer
confirmation. Every handler rejection, policy exception and issuer failure returns the same
no-store HTTP 502 body: `{"error":"unable_to_authorize_bugdrop"}`. There are no CORS response
headers, retries, redirects, downgrade paths or unverified capability fallbacks. The adapter must
preserve these response headers and must not cache the route.

## Browser setup

```ts
import { BugDropOptIn } from '@bugdrop/browser/opt-in';
import { tokenProviderWithMetadata } from './transport.js';

BugDropOptIn.init({
  applicationId: 'app_your_public_application_id',
  tokenProviderWithMetadata,
});
```

Import only `transport.ts` into the browser. The public application ID must match the configured
server application; it does not select server authority. P2 supplies binding and version metadata.
The transport posts to the fixed URL on `location.origin` and refuses HTTP. It uses
`redirect: 'error'`, `credentials: 'same-origin'`, `cache: 'no-store'` and
`referrerPolicy: 'no-referrer'`. Cookies remain local to the customer origin. The transport bounds
request bytes and response bytes, returns only capability fields, and throws a fixed error on
failure. P2 applies capability lifetime validation before widget delivery. Do not add retries or
replacement attempts after an ambiguous exchange.

## Verification and limits

Run `npx vitest run test/opt-in-backend*.test.ts` and `npm run validate` in this repository.
Tests use the actual P1 implementation and synthetic signed fixtures, exercise failure boundaries,
and bundle the transport to prove it includes no server module or Node crypto. Test-only source
resolution lets this example import the public SDK entry without depending on existing build output.
No external server, session system, issuer ledger, deployment or real credential is exercised.
