// Fixture globals belong to the test harness, never the shipped SDK declarations.
import type { SubmissionBinding } from '../packages/contracts/src/index.js';

declare global {
  interface Window {
    BugDrop?: {
      open(): void;
      close(): void;
      hide(): void;
      show(): void;
      isOpen(): boolean;
      isButtonVisible(): boolean;
      setTheme(mode: 'light' | 'dark' | 'auto'): void;
    };
    [key: `__bugdropSdkTokenProvider_${string}`]:
      ((binding: SubmissionBinding) => Promise<string>) | undefined;
  }
}
