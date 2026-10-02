import { BugDrop } from '@bugdrop/browser';
import { createV1TokenProvider } from './transport.js';

const button = document.querySelector<HTMLButtonElement>('#exchange');
const result = document.querySelector<HTMLElement>('#result');
if (!button || !result) throw new Error('fixture unavailable');

const csrf = button.dataset.csrf ?? '';
const controller = BugDrop.init({
  applicationId: 'app_local_loopback',
  widgetUrl: `${location.origin}/local-widget.js`,
  tokenProvider: createV1TokenProvider(() => csrf),
  button: false,
});

window.addEventListener('bugdrop:local-result', (event) => {
  const status = (event as CustomEvent<{ ok: boolean }>).detail?.ok;
  result.textContent = status
    ? 'Local capability received. No submission sent.'
    : 'Unable to authorize BugDrop';
  button.disabled = false;
});

button.addEventListener('click', async () => {
  button.disabled = true;
  result.textContent = 'Requesting local capability…';
  try {
    await controller.open();
  } catch {
    result.textContent = 'Unable to load local widget double';
    button.disabled = false;
  }
});

void controller.ready.then(
  () => {
    button.disabled = false;
  },
  () => {
    result.textContent = 'Unable to load local widget double';
  }
);
