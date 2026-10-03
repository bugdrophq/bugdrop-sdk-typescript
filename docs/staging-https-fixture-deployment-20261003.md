# Staging HTTPS SDK fixture: disabled deployment receipt

Recorded 2026-10-03. This receipt describes one staging deployment and its verified limits; it
does not qualify a live submission.

## Source and deployment

- Source: SDK `main` merge commit `50b61a44fabe438d939d95fde47b0d194f06db74` (PR #33),
  containing the reviewed fixture from PR #31. The merge commit tree matched the reviewed PR #33
  head. Deployment used a clean `git archive` of that exact merge commit, with fresh root and
  fixture-tooling `npm ci --ignore-scripts` installs; both audits reported zero vulnerabilities.
- Wrangler `4.147.0` dry run bundled the Worker, static assets, and SQLite Durable Object and
  reported only `FIXTURE_ENABLED="false"` as a variable. The deployed Worker is
  `bugdrop-sdk-customer-fixture-staging` in the BugDrop Cloudflare account. Deployment version:
  `c4b7fce1-81a6-4fb0-992d-0f33f59c83d1`.
- The custom domain is `sdk-fixture-staging.bugdrop.dev`. Before deployment, the hostname had no
  DNS answer and no matching Cloudflare DNS record, Worker route, or Worker custom domain. Wrangler
  reported the custom-domain trigger after deployment. Public A/AAAA resolution and a valid HTTPS
  certificate were then observed.
- `wrangler secret list --name bugdrop-sdk-customer-fixture-staging` returned `[]` after deployment.
  No Application key, operator password, issuer endpoint, or Application ID was set on the Worker.

## Live acceptance readback

All three requests used ordinary certificate verification and reached Cloudflare over HTTPS:

| Request                           | Expected                     | Observed                     |
| --------------------------------- | ---------------------------- | ---------------------------- |
| `GET /`                           | 503 while disabled           | 503, TLS verification passed |
| `GET /fixture.js`                 | 503, including static assets | 503, TLS verification passed |
| `POST /api/bugdrop-capability/v1` | 503 without issuer access    | 503, TLS verification passed |

The `GET /fixture.js` result checks the strongest realistic bypass of the off gate: Wrangler's
asset binding did not serve the bundle while `run_worker_first=true` and the gate was disabled.
Before deployment, `npm run validate` passed 634 tests and the security suite, and a local Wrangler
runtime returned 503 for these same paths. PR #33's final-head CI, CodeQL, dependency review, and
read-only PR review passed.

## Account state and remaining qualification

The separate staging Application **Managed SDK HTTPS fixture** is a draft with exact origin
`https://sdk-fixture-staging.bugdrop.dev` and saved destination
`jermwattml-svg/bugdrop-managed-staging-fixture`. The account readback says managed delivery is
disabled for the linked installation, and current destination access is unverified. The
Application's pending-key page said **No pending API keys** after the Worker deployment.

The next activation work must verify installation access, make the staging issuer and ingress
available, create a pending Application key and store it only as a Worker secret, configure the
exact origin/widget/issuer and an independent operator password, then deliberately enable the
fixture gate. A live hosted capability plus the signed-out, wrong-Origin, CSRF, replay,
cross-session, concurrency, rate-limit, and issuer-outage cases remain unrun on this hostname.
Keep managed delivery disabled until those checks and the ingress acknowledgement pass.
