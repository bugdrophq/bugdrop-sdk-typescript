import { mountFeedback } from '../beta-consumer/browser.js';

const button = document.querySelector<HTMLButtonElement>('#open');
const status = document.querySelector<HTMLElement>('#status');
if (!button || !status) throw new Error('Fixture unavailable');

const csrf = button.dataset.csrf ?? '';
const applicationId = button.dataset.application ?? '';
const widgetUrl = button.dataset.widget ?? '';
if (!csrf || !applicationId || !widgetUrl) throw new Error('Fixture unavailable');

const controller = mountFeedback({
  applicationId,
  widgetUrl,
  csrfToken: () => csrf,
});

button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = 'Opening BugDrop…';
  try {
    await controller.open();
    status.textContent = 'BugDrop opened.';
  } catch {
    status.textContent = 'Unable to open BugDrop.';
  } finally {
    button.disabled = false;
  }
});

void controller.ready.then(
  () => {
    button.disabled = false;
    status.textContent = 'Ready.';
  },
  () => {
    status.textContent = 'Widget unavailable.';
  }
);
