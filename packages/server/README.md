# `@bugdrop/server`

Server-only client for creating short-lived BugDrop submission capabilities.

```ts
import { BugDrop } from '@bugdrop/server';

const bugdrop = new BugDrop({ apiKey: process.env.BUGDROP_API_KEY });

// Call only after applying your application's own access controls.
const capability = await bugdrop.createSubmissionToken();
```

`BUGDROP_API_KEY` is the single server-only environment variable for this client. The SDK derives
an Application authentication bearer locally and sends neither the complete API key nor its root
secret to BugDrop. The request contains no customer user identifier and cannot select an
Application, repository, installation, labels, or privileged flow behavior.

BugDrop authenticates the Application, not the people using it. The customer application remains
responsible for authenticating and suspending its users and for enforcing user-specific limits.
BugDrop may independently apply Application-, credential-, network/IP-, replay-, payload-, and
platform-level protections.

`endpoint` and `fetch` constructor options exist for staging, contract tests, and the unfinished
control-plane integration. Do not point them at an untrusted service because the request carries a
derived Authorization bearer.
