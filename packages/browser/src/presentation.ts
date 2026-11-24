import type { BugDropPresentation } from './widget-presentation.generated.js';

export const PRESENTATION_READY_EVENT = 'bugdrop:presentation-ready';

export function serializePresentation(
  options: BugDropPresentation | undefined
): string | undefined {
  if (options === undefined) return undefined;
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('presentation must be an object');
  }
  let request: string;
  try {
    request = JSON.stringify({ version: 1, options: structuredClone(options) });
  } catch {
    throw new TypeError('presentation must contain serializable options');
  }
  if (request.length > 1024) throw new TypeError('presentation configuration is too large');
  return request;
}

export function acceptPresentationEvent(
  event: Event,
  script: HTMLScriptElement,
  request: string
): boolean {
  if (
    document.currentScript !== script ||
    event.target !== script ||
    !(event instanceof CustomEvent) ||
    event.detail !== request ||
    !event.cancelable
  )
    return false;
  event.preventDefault();
  return true;
}
