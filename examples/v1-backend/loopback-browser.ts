import { BugDrop } from '@bugdrop/browser';
import { createV1TokenProvider } from './transport.js';

const button = document.querySelector<HTMLButtonElement>('#exchange');
const result = document.querySelector<HTMLElement>('#result');
if (!button || !result || typeof BugDrop.init !== 'function')
  throw new Error('fixture unavailable');
const csrf = button.dataset.csrf ?? '';
const provider = createV1TokenProvider(() => csrf);
button.addEventListener('click', async () => {
  button.disabled = true;
  result.textContent = 'Requesting local capability…';
  try {
    const payload = new TextEncoder().encode('local fixture payload v1');
    const digest = await crypto.subtle.digest('SHA-256', payload);
    const payloadDigest = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
    const savedId = sessionStorage.getItem('bugdrop-v1-pending-id');
    const submissionId = savedId && /^[a-f0-9-]{36}$/.test(savedId) ? savedId : crypto.randomUUID();
    sessionStorage.setItem('bugdrop-v1-pending-id', submissionId);
    const capability = await provider({ submissionId, payloadDigest });
    sessionStorage.removeItem('bugdrop-v1-pending-id');
    result.textContent = `Local capability received; expires ${capability.expiresAt}. No submission sent.`;
  } catch {
    result.textContent = 'Unable to authorize BugDrop';
  } finally {
    button.disabled = false;
  }
});
