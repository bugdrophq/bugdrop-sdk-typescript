# Private hosted V1 consumer

This bundle uses the ordinary V1 public exports. V2 activation is not a prerequisite. Packages
remain unpublished previews; matching `0.1.0` versions alone do not identify a release candidate.
Use the full source commit and `provenance.json` SHA-256 values to identify the exact files.

## Produce and install

From a clean, committed SDK checkout using Node 22.22.3 and npm 11.19.1:

```sh
npm ci
npm run validate
npm run beta:bundle
npm run beta:check -- dist/beta-$(git rev-parse HEAD)
```

The command builds and packs both packages into `dist/beta-<full-commit>/vendor`, copies the
existing V1 helpers and two TypeScript entrypoints, and creates a private consumer manifest,
lockfile and provenance manifest. It refuses dirty source and an existing destination. It does
not publish, deploy, enable a fixture, or issue credentials. An optional absolute output directory
can be supplied with `npm run beta:bundle -- /absolute/new-directory`.

Transfer the **whole directory**, including `vendor`, through the approved private artifact channel.
Before installing, compare its provenance manifest to the producer's independently supplied copy;
verify every listed SHA-256. A manifest shipped beside modified files alone is not authentication.
Inside a fresh copy outside the SDK workspace:

```sh
npm ci
npm run build
```

Keep `vendor`, `package.json` and `package-lock.json` in the customer's private build inputs. The
relative `file:vendor/...` dependencies survive moving the bundle and lock npm installation to the
packed bytes. No workspace link or separately published contracts dependency is required.
The browser build contains only the loader and same-origin transport. The server entrypoint is
TypeScript for integration with the customer's existing server build, not a standalone HTTP daemon.

## Configure and mount

The beta operator first admits the tester's real GitHub/account identity. An unapproved identity
must be denied. Complete real workspace membership, GitHub App installation ownership, repository
selection, exact canonical HTTPS origin, and Application setup through the account flow. A stored
Application or acknowledged key is not proof that delivery is enabled. Have the runtime operator
confirm issuer, widget and delivery readiness for this Application and origin. Do not substitute
fixture seed state for fresh-account acceptance.

Store the V1 `bd_api_v1.…` key in the customer's server secret manager. Supply the exact saved origin
and explicit operator-approved capability endpoint to `capabilityEndpoint` in `src/server.ts`.
Mount the returned Fetch handler at `POST /api/bugdrop-capability/v1` through the existing server.
Do not derive its external origin from untrusted forwarding headers. Set HTTP body-read, policy and
connection deadlines and concurrency limits in that server adapter.

Pass your real `CustomerPolicy` callback. It must verify the authenticated session, active reporter
permission, server-expected `X-BugDrop-CSRF-Token`, and rate limits. Atomically and durably bind the
submission ID to its digest and authorized customer scope; the same ID with a changed digest or
another session/scope must fail. Retain bindings for the relevant replay lifetime. Do not deploy
`() => true`, an in-memory binding map, or a browser-provided identity as authorization.

On the authenticated page, call `mountFeedback` from `src/browser.ts` with the public `app_…` ID,
explicit approved widget HTTPS URL, and a callback reading the current customer CSRF token.
Handle rejection of the returned controller's `ready` promise with a visible unavailable state.
The controller also provides `open()` for an application-owned feedback button. Loading or opening
the widget does not mean feedback was delivered. The hosted widget owns report creation and delivery;
there is no second submission client in this example.

Only the Application ID, widget URL and customer CSRF token reach browser setup. Keep the API key,
customer identities, repository selectors, GitHub credentials and privileged configuration out of
browser bundles and logs. Exclude capability responses from caches, telemetry and request logging.

## Denial, revocation and uncertain results

The reused handler returns a fixed no-store 502 for denied policy, revoked credential, malformed
binding and issuer failure. The browser reports authorization unavailable; it cannot distinguish
these causes and must not claim that a key is valid, that nothing happened, or that a report was
sent. The operator checks redacted server/account evidence. Never fall back to anonymous ingress.

The hosted widget supplies the submission ID and digest of exact report bytes. Both helpers forward
that binding unchanged and never retry automatically. After a lost response, preserve the widget's
pending report and exact binding; use its explicit same-report recovery. Do not remount/reset the
widget, generate a new ID, or reserialize/edit the report to force a retry. If the widget cannot
recover its pending identity, stop and ask the operator to reconcile the retained receipt before
creating another report. An indeterminate outcome remains uncertain until authoritative evidence
resolves it; a retained receipt is not permission for a second GitHub operation.

## Acceptance still required

Local packed tests exercise public exports and synthetic failures. They do not prove hosted
admission, GitHub effects, revocation propagation or a fresh user's setup. The existing HTTPS
fixture is an operator-gated staging shell, not account onboarding; leave its gate under the
runtime owner's control.

Before opening beta, record exact SDK commit/hashes, hosted widget/runtime revision, account revision,
Application/origin and test window, without secrets. The owner and a second approved tester must
independently onboard, submit, see the correct GitHub Issue and dashboard receipt, and explicitly
recover a lost response/concurrent same-report retry with one delivery attempt. Also prove
unapproved and removed access, cross-tenant rejection, changed-digest denial, key revocation,
independent attempt/claim/command counts, limits, retention and rollback. The onboarding owner
prepares account changes; the runtime owner alone operates shared providers. This bundle neither
opens that window nor claims those live gates passed.
