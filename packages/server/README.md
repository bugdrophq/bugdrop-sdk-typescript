# `@bugdrop/server`

Server-only client for creating short-lived BugDrop submission capabilities.

```ts
import { BugDrop } from '@bugdrop/server';

const bugdrop = new BugDrop({
  secretKey: process.env.BUGDROP_SECRET_KEY,
  subjectKey: process.env.BUGDROP_SUBJECT_KEY,
});

// Call only after authenticating the request with your own session system.
const capability = await bugdrop.createSubmissionToken({ subject: user.id });
```

The raw subject is transformed locally into an Application-scoped HMAC pseudonym using the stable
`subjectKey`. The independent `secretKey` authenticates the request and may rotate without changing
that pseudonym. Rotating `subjectKey` requires a coordinated identity migration. The request body
cannot select an Application, repository, installation, labels, or privileged flow behavior.

`endpoint` and `fetch` constructor options exist for staging, contract tests, and the unfinished
control-plane integration. Do not point them at an untrusted service because the request carries
your Application credential in its Authorization header.
