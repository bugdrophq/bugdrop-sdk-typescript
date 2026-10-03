export interface FixtureStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  transaction<T>(callback: (tx: FixtureStorage) => Promise<T>): Promise<T>;
}

export interface FixtureStateContext {
  storage: FixtureStorage;
}

export interface FixtureStub {
  fetch(request: Request): Promise<Response>;
}

export interface FixtureExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface FixtureNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): FixtureStub;
}

export interface FixtureEnv {
  FIXTURE_ORIGIN: string;
  APPLICATION_ID: string;
  WIDGET_URL: string;
  OPERATOR_PASSWORD: string;
  BUGDROP_API_KEY: string;
  BUGDROP_CAPABILITY_ENDPOINT: string;
  FIXTURE_STATE: FixtureNamespace;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export interface FixtureSession {
  csrf: string;
  expiresAt: number;
  windowStart: number;
  requests: number;
  active?: { token: string; until: number };
}
