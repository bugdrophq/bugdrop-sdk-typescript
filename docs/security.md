# Security guidance

BugDrop authenticates Applications, not the people using customer applications. The SDK does not
send BugDrop a customer user identifier. The endpoint that calls `createSubmissionToken` must apply
the customer's own authentication, authorization, suspension, and abuse controls. It must be an
authenticated same-origin endpoint with the CSRF protection required by the customer's framework.
A public endpoint that returns capabilities provides no user-level security.

Apply the same protections you use for other state-changing same-origin endpoints:

- require the current authenticated session;
- reject cross-origin requests and validate CSRF tokens where your framework requires them;
- do not put the endpoint behind a cache or CDN response cache;
- enforce user-specific and network limits in the customer application;
- reject submission IDs reused for a different logical submission;
- return the capability only to the authenticated request that caused its creation.

Never use public framework prefixes for `BUGDROP_API_KEY`, including `NEXT_PUBLIC_` or `VITE_`.
Keep it in a server-only secret store. The browser package has no API-key option and does not import
`@bugdrop/server`. `npm run test:security` inspects the built browser artifacts and package graph for
regressions across this boundary.

BugDrop may enforce protections at the Application, credential, network/IP, replay, payload, and
platform levels. It cannot enforce customer user suspensions or user-specific limits because it
does not receive customer user identity. API-key rotation changes the accepted credential without
changing that responsibility boundary.

Every capability is bound to one `submissionId` and the canonical SHA-256 digest of the exact
submission request-body bytes. The ID is submission-scoped and must never be reused as, derived from,
or mapped to a customer user identifier in BugDrop inputs. Managed ingress must hash the received
bytes before parsing, compare both binding values, and consume the submission receipt before
delivery. Any mismatch fails closed; parsing and reserializing JSON is not an equivalent check.

Errors intentionally exclude remote response bodies and network exception details because those
systems sometimes echo authorization material. Use the error code and HTTP status for operational
diagnostics.
