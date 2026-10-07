# Packed SDK integration

`npm run test:integration` builds both packages, packs real npm tarballs, installs them offline
into an isolated temporary consumer, and loads `@bugdrop/server` through both ESM and CommonJS
public exports. The browser consumer is bundled from `@bugdrop/browser` with the browser target
and executed in a DOM environment. Package resolution must stay within the installed consumer's
`node_modules` and built artifacts. Temporary files and listeners are cleaned up on failure. The intentional isolated-consumer
`@bugdrop/server` lookup is recorded in `knip.json`; it is not a root runtime dependency.

These checks run in `npm run validate` and the required CI test job. The SDK-only HTTP fixture
exercises the V1 exchange, origin rejection, metadata, response validation, redacted failures,
and redirect refusal. It does not sign capabilities or simulate managed delivery. The browser
controller double proves packaged loader/provider behavior, not hosted-widget compatibility.

## Authoritative local service

Run the independent service suite with the Cloudflare repository's local-only adapter:

```sh
BUGDROP_LOCAL_SERVICE_ADAPTER=/absolute/path/to/bugdrop/managed/local/adapter.mjs \
  npm run test:integration:service
```

The service dependency is explicit; this command fails when the adapter is missing and never
substitutes a mocked signer. `test:integration` alone does not satisfy service conformance.
The service suite must pass before this tranche claims real local interoperability. Neither suite
satisfies the production endpoint or real hosted-widget publication gates in [protocol.md](protocol.md).

The adapter's test-only `start({ fixtures })` receives the six merged V1 fixtures, keyed by their
full filenames. It supplies `endpoint`, `origin`, `submit`, `revoke`, `expireAuthorizationState`,
`setDeliveryIndeterminate`, `evidence`, and `close`. Capability exchange uses actual HTTP and the
packed server SDK. The service owns capability signatures, claims, verifier storage, and receipt
logic. `submit({ capability, binding, requestBody })` exercises its local ingress implementation;
this adapter is not a published submission HTTP route. No service wire fields are defined here.

Each failure scenario starts a fresh local service. Tests require exact normalized outcome objects,
verify changed-body and submission-ID rejection, tampered-capability rejection, revoked/stale
projection rejection, and exactly one delivery attempt in each delivered/indeterminate scenario.
Those scenarios reject a repeat of the consumed token, mint two distinct replacement tokens for
the same submission ID/body, and submit the replacements concurrently. Both return the retained
outcome. Replaying each replacement must then be rejected, proving that receipt reuse also consumes
tokens. Each scenario therefore requires three successful exchanges and six submissions. Every
minted token is checked as a private canary; reusing a minted token fails before further submits.
SDK-owned adversarial doubles verify that repeated tokens, second delivery attempts, replay success,
replacement-token replay success, and replacement-token leaks fail both harnesses. These doubles do not prove the external service.
Evidence is checked for report, credential, token, and identity canaries. Test-owned observations
of actual telemetry requests must contain only the SDK version, fixed transport headers, and explicit
false unexpected-header/URL markers. The observations must match the exact expected counts; raw
submission responses must exactly match the normalized outcomes. Negative evidence mutations prove
that extra headers, response fields, private canaries, and concealed outcomes fail the assertions. Content-free evidence
must not include report bodies, page URLs, raw headers, or reporter identifiers.

The current public system remains supported and unchanged. The transport fixture's deliberately
unreachable `/current-public` redirect target is an attack canary, not a public-service integration.
All fixture credentials are the existing non-production compatibility vector. No remote resources,
new secrets, live GitHub installations, publication, or deployment are involved.
