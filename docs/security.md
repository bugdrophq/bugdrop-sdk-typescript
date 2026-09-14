# Security guidance

The SDK cannot authenticate your users. The endpoint that calls `createSubmissionToken` must first
validate the application's real session. A public endpoint that returns capabilities provides no
authenticated security.

Apply the same protections you use for other state-changing same-origin endpoints:

- require the current authenticated session;
- reject cross-origin requests and validate CSRF tokens where your framework requires them;
- do not put the endpoint behind a cache or CDN response cache;
- rate-limit capability creation by account and network dimensions;
- pass a stable opaque subject rather than an email, name, or profile object;
- return the capability only to the authenticated request that caused its creation.

Never prefix a server environment variable with framework conventions that expose it to browser
bundles (for example, `NEXT_PUBLIC_` or `VITE_`). The browser package has no `secretKey` option and
does not import `@bugdrop/server`. `npm run test:security` inspects the built browser artifacts and
package graph for regressions across this boundary.

Errors intentionally exclude remote response bodies and network exception details because those
systems sometimes echo authorization material. Use the error code and HTTP status for operational
diagnostics.
