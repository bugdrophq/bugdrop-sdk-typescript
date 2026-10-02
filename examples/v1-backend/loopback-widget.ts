// Local test double for the hosted widget's public API and token-provider hook.
// It makes no submission and never exposes a capability to the page.
type Hook = (binding: { submissionId: string; payloadDigest: string }) => Promise<string>;

async function pendingBinding(): Promise<{ submissionId: string; payloadDigest: string }> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('local fixture payload v1')
  );
  const payloadDigest = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  const saved = sessionStorage.getItem('bugdrop-v1-pending-binding');
  if (saved) {
    let value: unknown;
    try {
      value = JSON.parse(saved);
    } catch {
      throw new Error('pending binding unavailable');
    }
    if (
      !value ||
      typeof value !== 'object' ||
      !('submissionId' in value) ||
      !('payloadDigest' in value) ||
      typeof value.submissionId !== 'string' ||
      typeof value.payloadDigest !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        value.submissionId
      ) ||
      value.payloadDigest !== payloadDigest
    )
      throw new Error('pending binding unavailable');
    return { submissionId: value.submissionId, payloadDigest };
  }
  const binding = { submissionId: crypto.randomUUID(), payloadDigest };
  sessionStorage.setItem('bugdrop-v1-pending-binding', JSON.stringify(binding));
  return binding;
}

export function installLocalWidget(script: HTMLScriptElement): void {
  const name = script.dataset.authTokenProvider;
  if (!name || !name.startsWith('__bugdropSdkTokenProvider_'))
    throw new Error('provider unavailable');
  const hook = (window as unknown as Record<string, unknown>)[name];
  if (typeof hook !== 'function') throw new Error('provider unavailable');
  let active = false;
  const exchange = async () => {
    if (active) return;
    active = true;
    let ok = false;
    try {
      const binding = await pendingBinding();
      const token = await (hook as Hook)(binding);
      if (typeof token !== 'string' || !token) throw new Error();
      sessionStorage.removeItem('bugdrop-v1-pending-binding');
      ok = true;
    } catch {
      // The next click is the only retry. Preserve the exact pending binding.
    } finally {
      active = false;
      window.dispatchEvent(new CustomEvent('bugdrop:local-result', { detail: { ok } }));
    }
  };
  window.BugDrop = {
    open: () => void exchange(),
    close: () => {},
    hide: () => {},
    show: () => {},
    isOpen: () => false,
    isButtonVisible: () => false,
    setTheme: () => {},
  };
}

if (typeof document !== 'undefined' && document.currentScript instanceof HTMLScriptElement) {
  installLocalWidget(document.currentScript);
}
