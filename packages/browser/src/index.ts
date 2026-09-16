import {
  BUGDROP_CONTRACT_VERSION,
  parseSubmissionBinding,
  parseUsableSubmissionCapability,
  type SubmissionCapability,
  type SubmissionBinding,
} from '../../contracts/src/index.js';

const DEFAULT_WIDGET_URL = 'https://bugdrop.neonwatty.workers.dev/widget.v1.js';
const DEFAULT_LOAD_TIMEOUT_MS = 10_000;

export type BugDropTheme = 'light' | 'dark' | 'auto';
export type BugDropPosition = 'bottom-right' | 'bottom-left';
export type SubmissionTokenProvider = (
  binding: SubmissionBinding
) => SubmissionCapability | Promise<SubmissionCapability>;

export interface BugDropBrowserOptions {
  applicationId: string;
  tokenProvider: SubmissionTokenProvider;
  widgetUrl?: string;
  loadTimeoutMs?: number;
  theme?: BugDropTheme;
  position?: BugDropPosition;
  button?: boolean;
}

interface HostedWidgetApi {
  open(): void;
  close(): void;
  hide(): void;
  show(): void;
  isOpen(): boolean;
  isButtonVisible(): boolean;
  setTheme(mode: BugDropTheme): void;
}

declare global {
  interface Window {
    BugDrop?: HostedWidgetApi;
    [key: `__bugdropSdkTokenProvider_${string}`]:
      ((binding: SubmissionBinding) => Promise<string>) | undefined;
  }
}

let providerSequence = 0;
let activeController: BugDropController | undefined;
let activeApplicationId: string | undefined;

export class BugDropController {
  readonly ready: Promise<void>;
  readonly #apiPromise: Promise<HostedWidgetApi>;

  constructor(apiPromise: Promise<HostedWidgetApi>) {
    this.#apiPromise = apiPromise;
    this.ready = apiPromise.then(() => undefined);
  }

  async open(): Promise<void> {
    (await this.#apiPromise).open();
  }

  async close(): Promise<void> {
    (await this.#apiPromise).close();
  }

  async hide(): Promise<void> {
    (await this.#apiPromise).hide();
  }

  async show(): Promise<void> {
    (await this.#apiPromise).show();
  }

  async isOpen(): Promise<boolean> {
    return (await this.#apiPromise).isOpen();
  }

  async isButtonVisible(): Promise<boolean> {
    return (await this.#apiPromise).isButtonVisible();
  }

  async setTheme(mode: BugDropTheme): Promise<void> {
    (await this.#apiPromise).setTheme(mode);
  }
}

export class BugDrop {
  static init(options: BugDropBrowserOptions): BugDropController {
    assertBrowserRuntime();
    validateOptions(options);
    if (activeController) {
      if (activeApplicationId !== options.applicationId) {
        throw new Error('BugDrop is already initialized for another Application');
      }
      return activeController;
    }
    if (window.BugDrop) {
      throw new Error('A BugDrop widget is already installed on this page');
    }

    const apiPromise = loadHostedWidget(options);
    activeController = new BugDropController(apiPromise);
    activeApplicationId = options.applicationId;
    void apiPromise.catch(() => {
      activeController = undefined;
      activeApplicationId = undefined;
    });
    return activeController;
  }
}

function loadHostedWidget(options: BugDropBrowserOptions): Promise<HostedWidgetApi> {
  const providerName = `__bugdropSdkTokenProvider_${Date.now()}_${++providerSequence}` as const;
  const script = document.createElement('script');
  const widgetUrl = validateServiceUrl(options.widgetUrl ?? DEFAULT_WIDGET_URL, 'widgetUrl');
  const timeoutMs = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;

  window[providerName] = async (binding: SubmissionBinding) => {
    let capability: SubmissionCapability;
    try {
      const parsedBinding = parseSubmissionBinding(binding);
      capability = parseUsableSubmissionCapability(await options.tokenProvider(parsedBinding));
    } catch {
      throw new Error('Unable to authorize BugDrop');
    }

    return capability.token;
  };

  script.src = widgetUrl;
  script.dataset.applicationId = options.applicationId;
  script.dataset.authTokenProvider = providerName;
  script.dataset.contractVersion = String(BUGDROP_CONTRACT_VERSION);
  if (options.theme) script.dataset.theme = options.theme;
  if (options.position) script.dataset.position = options.position;
  if (options.button !== undefined) script.dataset.button = String(options.button);

  return new Promise<HostedWidgetApi>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(
      () => fail('Timed out loading the BugDrop widget'),
      timeoutMs
    );

    const cleanupListeners = () => {
      window.clearTimeout(timeout);
      window.removeEventListener('bugdrop:ready', onReady);
      script.removeEventListener('error', onError);
      script.removeEventListener('load', onLoad);
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      delete window[providerName];
      script.remove();
      reject(new Error(message));
    };

    const finish = () => {
      if (settled) return;
      const api = window.BugDrop;
      if (!isHostedWidgetApi(api)) {
        fail('The hosted BugDrop widget did not expose a compatible API');
        return;
      }
      settled = true;
      cleanupListeners();
      resolve(api);
    };

    const onReady = () => finish();
    const onError = () => fail('Unable to load the BugDrop widget');
    const onLoad = () => finish();

    window.addEventListener('bugdrop:ready', onReady, { once: true });
    script.addEventListener('error', onError, { once: true });
    script.addEventListener('load', onLoad, { once: true });
    document.head.appendChild(script);
  });
}

function validateOptions(options: BugDropBrowserOptions): void {
  if (!options || typeof options !== 'object') {
    throw new TypeError('BugDrop.init requires an options object');
  }
  if (
    typeof options.applicationId !== 'string' ||
    options.applicationId.length < 3 ||
    options.applicationId.length > 200 ||
    options.applicationId !== options.applicationId.trim()
  ) {
    throw new TypeError('BugDrop requires a valid public Application ID');
  }
  if (typeof options.tokenProvider !== 'function') {
    throw new TypeError('BugDrop requires a submission token provider');
  }
  if (options.theme !== undefined && !['light', 'dark', 'auto'].includes(options.theme)) {
    throw new TypeError('theme must be light, dark, or auto');
  }
  if (
    options.position !== undefined &&
    !['bottom-right', 'bottom-left'].includes(options.position)
  ) {
    throw new TypeError('position must be bottom-right or bottom-left');
  }
  if (options.button !== undefined && typeof options.button !== 'boolean') {
    throw new TypeError('button must be a boolean');
  }
  assertOnlyKeys(options, [
    'applicationId',
    'tokenProvider',
    'widgetUrl',
    'loadTimeoutMs',
    'theme',
    'position',
    'button',
  ]);
  if (
    options.loadTimeoutMs !== undefined &&
    (!Number.isFinite(options.loadTimeoutMs) || options.loadTimeoutMs <= 0)
  ) {
    throw new TypeError('loadTimeoutMs must be a positive number');
  }
}

function assertOnlyKeys(value: object, allowedKeys: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new TypeError('BugDrop options contain unsupported fields');
  }
}

function validateServiceUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${field} must be a valid URL`);
  }
  const localDevelopment = url.hostname === 'localhost' || url.hostname.endsWith('.localhost');
  if (
    (url.protocol !== 'https:' && !(localDevelopment && url.protocol === 'http:')) ||
    url.username ||
    url.password
  ) {
    throw new TypeError(`${field} must use HTTPS without embedded credentials`);
  }
  return url.href;
}

function isHostedWidgetApi(value: unknown): value is HostedWidgetApi {
  if (!value || typeof value !== 'object') return false;
  const api = value as Record<string, unknown>;
  return ['open', 'close', 'hide', 'show', 'isOpen', 'isButtonVisible', 'setTheme'].every(
    (method) => typeof api[method] === 'function'
  );
}

function assertBrowserRuntime(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('@bugdrop/browser must be initialized in a browser');
  }
}
