# `@bugdrop/server`

Server-only client for creating short-lived BugDrop submission capabilities.

```ts
import { BugDrop } from '@bugdrop/server';

const bugdrop = new BugDrop({ apiKey: process.env.BUGDROP_API_KEY });

// Call only after authenticating the request with your own session system.
const capability = await bugdrop.createSubmissionToken({ subject: user.id });
```

`BUGDROP_API_KEY` is the single server-only environment variable for this client. The SDK derives
both the Authorization bearer and the Application-scoped HMAC pseudonym locally. It sends only the
derived bearer and pseudonym to BugDrop: never the full API key, its root secret, or the raw
subject. Rotating the API key starts a new pseudonymous identity epoch, including new
pseudonym-based limits and blocks. The request body cannot select an Application, repository,
installation, labels, or privileged flow behavior.

`endpoint` and `fetch` constructor options exist for staging, contract tests, and the unfinished
control-plane integration. Do not point them at an untrusted service because the request carries a
derived Authorization bearer.
