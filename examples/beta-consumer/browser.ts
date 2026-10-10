import { BugDrop } from '@bugdrop/browser';
import { createV1TokenProvider } from './transport.js';

// Call once after your authenticated page has loaded. These values are public.
export function mountFeedback(options: {
  applicationId: string;
  widgetUrl: string;
  csrfToken: () => string;
}) {
  return BugDrop.init({
    applicationId: options.applicationId,
    widgetUrl: options.widgetUrl,
    tokenProvider: createV1TokenProvider(options.csrfToken),
  });
}
