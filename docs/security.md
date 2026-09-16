# Capability-endpoint security contract

BugDrop authenticates Applications, not the people using customer applications. The SDK does not
send BugDrop a customer user identifier. The customer decides whether its reporters must sign in and
owns all user authentication, authorization, suspension, and user-specific abuse controls. A public
customer endpoint that returns capabilities provides no user-level security; BugDrop cannot add that
security because it deliberately receives no stable end-user identifier.

Every customer capability endpoint MUST:

- keep `BUGDROP_API_KEY` in server-only configuration and call `@bugdrop/server` only on the server;
- accept only `POST` with a small JSON body containing `submissionId` and `payloadDigest`;
- compare the request `Origin` to an exact customer-owned allowlist before issuing a capability;
- return `Cache-Control: no-store` and prevent CDN or application response caching;
- forward the exact binding supplied by the hosted widget without deriving either value from a user;
- reject a submission ID reused for a different logical submission;
- return normalized errors without remote bodies, tokens, headers, stack locals, or binding values;
- avoid logging the API key, derived bearer, capability, submission ID, digest, or response body; and
- apply application/network safety limits plus any user-specific controls required by the customer.

The server SDK sends its package version in `X-BugDrop-SDK-Version`, and the browser loader exposes
its package version to the hosted widget as `data-sdk-version`. These values support compatibility
and delivery diagnostics; they contain no customer or reporter identifier.

If the endpoint uses cookies or requires a signed-in reporter, it MUST also validate the current
session and apply the framework's normal CSRF defense. SameSite cookies alone are not a substitute
for an exact `Origin` check. Anonymous customer applications remain responsible for deciding who can
reach the endpoint and for containing abuse before requesting shared Application capabilities.

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

Reference implementations are maintained for [Next.js](examples/nextjs-route.md) and
[Express](examples/express-route.md). They show the protocol boundary, not a universal user-auth or
rate-limiting system; replace the marked customer-policy hooks with controls appropriate to the
application.
