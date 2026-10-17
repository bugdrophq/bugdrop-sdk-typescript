import { BugDrop } from '@bugdrop/browser';
import { createAnonymousTokenProvider } from './transport.js';

export function mountFeedback(options: { applicationId: string; widgetUrl: string }) {
  return BugDrop.init({ ...options, tokenProvider: createAnonymousTokenProvider() });
}
