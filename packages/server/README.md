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
tests. There is no legacy fallback. Do not point an override at an untrusted service because the
request carries a derived Authorization bearer.

`origin`, when supplied, must be one exact canonical HTTPS origin. HTTP is accepted only for
explicit loopback development hosts. See the repository [security contract](../../docs/security.md)
and maintained [Next.js](../../docs/examples/nextjs-route.md) and
[Express](../../docs/examples/express-route.md) endpoint examples.
