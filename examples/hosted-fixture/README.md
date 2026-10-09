# HTTPS customer SDK fixture

This is a staging-only customer application shell for the V1 BugDrop SDK. It uses the packed
`@bugdrop/browser` loader and `@bugdrop/server` through the existing V1 same-origin handler.
It does **not** issue credentials, create an Application, install a GitHub App, or enable delivery.
The browser sees only the public Application ID, widget URL, and a session-specific CSRF token.

## Controls

- The Worker requires one exact configured HTTPS origin and serves only `/`, `/login`,
  `/fixture.js`, and `POST /api/bugdrop-capability/v1`. No proxy or fallback route exists.
- The staging custom domain is `sdk-fixture-staging.bugdrop.dev`. Its checked-in rollout gate is
  `FIXTURE_ENABLED = "false"`; every request returns 503 until an operator deliberately enables it
  after the separate Application and issuer bindings are verified. The gate is checked before
  origin matching, asset serving, session lookup, or issuer access.
- Operator sign-in uses a separate password binding. The session cookie is Secure, HttpOnly,
  SameSite=Strict, host-only, and expires after 30 minutes. The Durable Object stores the
  server-side session and CSRF token.
- The V1 handler checks method, exact request URL and Origin, content type, bounded body, and
  binding format before the customer policy. The policy checks session and CSRF and atomically
  stores each submission ID with its digest and session in one Durable Object transaction.
  Reuse with a different digest or session is denied. Bindings remain until the fixture's
  Durable Object storage is deliberately retired.
- The policy permits at most eight authorized requests per session per minute and one active
  exchange per session. A lease expires after nine seconds if the Worker dies. The issuer
  timeout is five seconds and the capability response has an eight-second deadline. Lease
  cleanup runs through the Worker execution context after the response is ready. Denials are
  redacted, no-store, and never fall back to a local token. Operator sign-in is also limited to
  eight attempts per minute across this staging fixture.
- The API key, operator password, origin, issuer endpoint, Application ID, and widget URL are
  deployment bindings. This repository contains no values or usable credential.

## Build and qualification

Run `npm ci` at the repository root, then `npm run example:hosted:build`,
`npx vitest run test/hosted-fixture.test.ts`, `npm run validate`, and
`npm run test:security`. The root workspace supports Node 20 or 22. For the optional
Wrangler dry run, use Node 22 or newer, run `npm ci --prefix examples/hosted-fixture`,
then `npm run example:hosted:dry-run` from the repository root. Wrangler is pinned in the
fixture's private package and lockfile; it is not part of the root workspace install.
The build produces the browser bundle from the installed workspace package in `public/fixture.js`.
The Wrangler dry run confirms that the Worker, its Node-compatible server package, static asset,
and Durable Object bundle; it does not deploy or assign a route.
Wrangler's browser-oriented resolver would select the intentionally empty browser guard of
`@bugdrop/server`, so `wrangler.toml` explicitly aliases that import to the built server entry.
The dry run must show no missing-export warning.

Before an operator deploys, confirm that the dedicated fixture hostname is still unclaimed in the
`bugdrop.dev` Cloudflare zone and does not collide with account or managed ingress. The Wrangler
custom domain creates DNS and a certificate when deployed; no separate DNS record is needed.
The first deployment must retain `FIXTURE_ENABLED = "false"` and have no Application key or issuer
binding. Verify that all paths, including `/fixture.js` and the capability endpoint, return 503
at the HTTPS hostname before preparing activation. Configure these
bindings on the Worker without copying secrets into shell history, code, or docs:

| Binding                       | Required value                                                         |
| ----------------------------- | ---------------------------------------------------------------------- |
| `FIXTURE_ENABLED`             | `false` for route qualification; `true` only after activation approval |
| `FIXTURE_ORIGIN`              | Exact canonical HTTPS origin assigned to this Worker                   |
| `APPLICATION_ID`              | Public ID of a separate fixture Application registered for that origin |
| `WIDGET_URL`                  | Explicit staging hosted widget HTTPS script URL                        |
| `OPERATOR_PASSWORD`           | Independent strong operator password                                   |
| `BUGDROP_API_KEY`             | Pending server-only key issued for that Application                    |
| `BUGDROP_CAPABILITY_ENDPOINT` | Explicit approved staging issuer HTTPS URL                             |
| `FIXTURE_STATE`               | Dedicated SQLite Durable Object namespace from `wrangler.toml`         |
| `ASSETS`                      | Generated browser bundle from `public/`                                |

**Hold points:** Keep the Application paused and delivery disabled until the HTTPS origin,
Application selection, credential issuance, and issuer URL are independently read back. Deploy
only after owner approval of the concrete route and bindings. Test signed-out, wrong Origin,
missing/wrong CSRF, cross-session ID reuse, changed digest, concurrent requests, rate limit,
upstream outage, and successful hosted capability before allowing any real submission. A
successful local or dry-run test is not staging acceptance evidence. Record the staging issuer
response and hosted widget behavior without copying tokens or request bodies to logs.

## Browser form origin

The fixture page uses `Referrer-Policy: same-origin`. Native same-origin form posts then
preserve their `Origin` header, which the login handler requires. `no-referrer` makes
Chromium send `Origin: null` for this navigation and prevents the operator from signing
in. Cross-origin requests still receive no referrer; absent, null, and foreign login
origins remain rejected.
