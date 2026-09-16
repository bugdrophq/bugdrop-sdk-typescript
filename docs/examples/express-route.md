# Express capability route

This example assumes `express.json({ limit: '2kb', type: 'application/json' })` is configured before
the route. Replace the marked middleware with the application's own reporter-access and rate-limit
policy. Anonymous reporting is an application decision, not a BugDrop SDK feature.

```ts
import { BugDrop } from '@bugdrop/server';
import type { Request, Response } from 'express';

const applicationOrigin = requireServerSetting('APPLICATION_ORIGIN');
const bugdrop = new BugDrop({ apiKey: process.env.BUGDROP_API_KEY });

app.post(
  '/api/bugdrop-capability',
  customerAccessPolicy,
  customerRateLimit,
  async (request: Request, response: Response) => {
    response.set('Cache-Control', 'no-store');
    if (request.get('origin') !== applicationOrigin) {
      response.status(403).json({ error: 'forbidden' });
      return;
    }

    try {
      const { submissionId, payloadDigest } = request.body;
      const capability = await bugdrop.createSubmissionToken({
        submissionId,
        payloadDigest,
        origin: applicationOrigin,
        environment: 'production',
      });
      response.json(capability);
    } catch {
      response.status(502).json({ error: 'unable_to_authorize_bugdrop' });
    }
  }
);
```

For cookie-authenticated routes, `customerAccessPolicy` must include the application's normal CSRF
protection. Do not log the request body, API key, derived bearer, capability, or upstream response.
