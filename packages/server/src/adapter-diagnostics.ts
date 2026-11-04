export type FailurePhase =
  | 'configuration'
  | 'node_envelope'
  | 'adaptation'
  | 'body'
  | 'binding'
  | 'policy'
  | 'sdk_init'
  | 'issuer_exchange'
  | 'deadline'
  | 'cancelled';
type FailureReason =
  | 'disabled'
  | 'incomplete'
  | 'rejected'
  | 'unavailable'
  | 'denied'
  | 'failed'
  | 'expired'
  | 'aborted';
export type FailureDiagnostic = Readonly<{
  phase: FailurePhase;
  reason: FailureReason;
  issuerContacted: boolean;
  httpStatus?: number;
  keyPresent?: boolean;
  originMatches?: boolean;
  issuerMatches?: boolean;
  hostMatches?: boolean;
  pathMatches?: boolean;
  methodMatches?: boolean;
  contentTypeMatches?: boolean;
  fetchSiteMatches?: boolean;
  encodingAllowed?: boolean;
  streamAvailable?: boolean;
}>;
export type FailureObserver = (event: FailureDiagnostic) => void | Promise<void>;

/** One sanitized event per invocation; telemetry must never affect authorization. */
export function failureReporter(observer: FailureObserver = () => {}) {
  let emitted = false;
  return (event: FailureDiagnostic): void => {
    if (emitted) return;
    emitted = true;
    const safe: FailureDiagnostic = Object.freeze({
      phase: (
        [
          'configuration',
          'node_envelope',
          'adaptation',
          'body',
          'binding',
          'policy',
          'sdk_init',
          'issuer_exchange',
          'deadline',
          'cancelled',
        ] as const
      ).includes(event.phase)
        ? event.phase
        : 'sdk_init',
      reason: (
        [
          'disabled',
          'incomplete',
          'rejected',
          'unavailable',
          'denied',
          'failed',
          'expired',
          'aborted',
        ] as const
      ).includes(event.reason)
        ? event.reason
        : 'failed',
      issuerContacted: event.issuerContacted === true,
      ...(Number.isInteger(event.httpStatus) && event.httpStatus! >= 100 && event.httpStatus! <= 599
        ? { httpStatus: event.httpStatus }
        : {}),
      ...Object.fromEntries(
        (
          [
            'keyPresent',
            'originMatches',
            'issuerMatches',
            'hostMatches',
            'pathMatches',
            'methodMatches',
            'contentTypeMatches',
            'fetchSiteMatches',
            'encodingAllowed',
            'streamAvailable',
          ] as const
        )
          .filter((key) => typeof event[key] === 'boolean')
          .map((key) => [key, event[key]])
      ),
    });
    try {
      void Promise.resolve(observer(safe)).catch(() => {});
    } catch {
      /* Diagnostics are best effort. */
    }
  };
}
