# Security guidance

The SDK cannot authenticate your users. The endpoint that calls `createSubmissionToken` must first
validate the application's real session. It must be an authenticated same-origin endpoint with the
CSRF protection required by the customer's framework. A public endpoint that returns capabilities
provides no authenticated security.

Apply the same protections you use for other state-changing same-origin endpoints:

- require the current authenticated session;
- reject cross-origin requests and validate CSRF tokens where your framework requires them;
- do not put the endpoint behind a cache or CDN response cache;
- rate-limit capability creation by account and network dimensions;
- pass a stable opaque subject rather than an email, name, or profile object;
- return the capability only to the authenticated request that caused its creation.

Never use public framework prefixes for `BUGDROP_API_KEY`, including `NEXT_PUBLIC_` or `VITE_`.
Keep it in a server-only secret store. The browser package has no API-key option and does not import
`@bugdrop/server`. `npm run test:security` inspects the built browser artifacts and package graph for
regressions across this boundary.

Rotating `BUGDROP_API_KEY` begins a new pseudonymous identity epoch: pseudonym-based limits and
blocks reset rather than migrate. During an old/new-key deployment overlap, the same user has two
pseudonyms and per-user counters can temporarily split. Maintain customer-side per-user limits
during that overlap; Application and network limits should remain in effect as well.

Errors intentionally exclude remote response bodies and network exception details because those
systems sometimes echo authorization material. Use the error code and HTTP status for operational
diagnostics.
