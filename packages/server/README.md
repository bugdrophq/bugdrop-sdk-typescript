# `@bugdrop/server`

Server-only client for creating short-lived BugDrop submission capabilities.

```ts
import { BugDrop } from '@bugdrop/server';

const bugdrop = new BugDrop({ apiKey: process.env.BUGDROP_API_KEY });

// Call only after applying your application's own access controls.
const capability = await bugdrop.createSubmissionToken({
  submissionId,
  payloadDigest,
});
```

`BUGDROP_API_KEY` is the single server-only environment variable for this client. The SDK derives
an Application authentication bearer locally and sends neither the complete API key nor its root
secret to BugDrop. The request contains no customer user identifier and cannot select an
Application, repository, installation, labels, or privileged flow behavior.

`submissionId` is an opaque identifier for one submission, not a user. `payloadDigest` is canonical
unpadded base64url SHA-256 over the exact submission request-body bytes. Do not parse and
reserialize JSON before hashing: whitespace, property order, and every other byte are significant.
The hosted widget supplies both values through the browser package's token-provider binding.

BugDrop authenticates the Application, not the people using it. The customer application remains
responsible for authenticating and suspending its users and for enforcing user-specific limits.
BugDrop may independently apply Application-, credential-, network/IP-, replay-, payload-, and
platform-level protections.

The default endpoint is the versioned managed service at
`https://api.bugdrop.dev/v1/submission-capabilities`. `endpoint` and `fetch` constructor options
exist for staging, loopback development, customer-controlled proxies, self-hosting, and contract
tests. There is no fallback to the current public service. Do not point an override at an untrusted service because the
request carries a derived Authorization bearer.

`origin`, when supplied, must be one exact canonical HTTPS origin. HTTP is accepted only for
explicit loopback development hosts. See the repository [security contract](../../docs/security.md)
and maintained [Next.js](../../docs/examples/nextjs-route.md) and
[Express](../../docs/examples/express-route.md) endpoint examples.

## Explicit opt-in exchange

```ts
import { BugDropOptIn, BugDropOptInError } from '@bugdrop/server/opt-in';

// trustedConfiguration comes from your reviewed server-side configuration export.
// It includes the exact endpoint/origin/scope, catalog and pinned confirmation keys.
const optIn = new BugDropOptIn({
  ...trustedConfiguration,
  apiKey: process.env.BUGDROP_OPT_IN_API_KEY!, // separately provisioned bd_api_v2 key
});

const capability = await optIn.createSubmissionCapability(
  { submissionId, payloadDigest },
  { metadataVersion: 1, browserSdkVersion }
);
```

The opt-in entry point requires an explicit canonical HTTPS endpoint and origin, public
`applicationId`, internal `credentialId` and original `installationGeneration`, credential
`keyId`, `deploymentDigest`, `catalogDigest`, full version `catalog`, and
`confirmationKeys: [{ kid, publicKey: { kty: 'EC', crv: 'P-256', x, y } }]`.
Obtain these together from the trusted configuration export; browser input must not
choose them. The server version is read from this package. Browser versions use the
frozen finite catalog; syntactically valid unknown versions normalize to null.

The SDK returns only the capability envelope after checking a pinned signed confirmation
of the complete request and capability bytes, including issuer reservation/deadline
arithmetic. It never releases an unverified token. The exchange seals success after eight
seconds, including response reading and verification. SDK-held pending context is cleared
at that seal, within the additional five-second cleanup allowance, even when an injected
fetch ignores abort. A transport implementation can retain its own copies; inject only a
trusted server transport. No pending context is persisted by the SDK.

`BugDropOptInError.code` is `rejected_before_send` for invalid local input or
`exchange_unconfirmed` after any attempted send without verified confirmation. Neither
remote errors nor timeouts prove zero issuance. Do not retry, create a replacement
submission/attempt, fall back to V1, or log request bodies, credentials or capabilities.
There is no automatic retry, redirect, key discovery or catalog refresh. A successful
mocked client exchange is not evidence of issuer durable authorization accounting.

This client requires the separately qualified V2 issuer, credentials, publication and
online verification infrastructure described by the frozen P0 contract. Installing the
package does not provision or enable them. Existing `@bugdrop/server` V1 exports remain
unchanged; `@bugdrop/server/opt-in` is server-only in both runtime and package exports.
