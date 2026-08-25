/** Typed error classes distinguishing check-failed causes (POLL-04). */

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Thrown when the response was not JSON (e.g. an HTML WAF/error page instead
 *  of the expected API response) — see RESEARCH Pitfall 2. */
export class BlockedError extends Error {
  constructor(
    message: string,
    readonly url: string
  ) {
    super(message);
    this.name = 'BlockedError';
  }
}

export class ResponseSchemaError extends Error {
  constructor(
    message: string,
    readonly issues: string
  ) {
    super(message);
    this.name = 'ResponseSchemaError';
  }
}

export class FacilityNotFoundError extends Error {
  constructor(
    message: string,
    readonly parkName: string
  ) {
    super(message);
    this.name = 'FacilityNotFoundError';
  }
}

/** Thrown when a RecArea name in watches.json matches nothing in RIDB's /recareas
 *  search (AREA-01). The area name is developer-authored config, never a secret,
 *  so echoing it back is safe — unlike request headers or the apikey. */
export class RecAreaNotFoundError extends Error {
  constructor(
    message: string,
    readonly areaName: string
  ) {
    super(message);
    this.name = 'RecAreaNotFoundError';
  }
}

/**
 * One-line human-readable failure reason for the FAILED log line + RunSummary.
 *
 * MUST NOT throw for any input and MUST NOT include HTTP request headers or an
 * `apikey` value in its output (threat T-01-02).
 */
export function describeFailure(err: unknown): string {
  if (err instanceof HttpError) {
    return `HTTP ${err.status} from ${err.url}`;
  }
  if (err instanceof BlockedError) {
    return `blocked: non-JSON response from ${err.url} (likely User-Agent/WAF block)`;
  }
  if (err instanceof ResponseSchemaError) {
    return `unexpected API response shape: ${err.issues}`;
  }
  if (err instanceof FacilityNotFoundError) {
    return `no Recreation.gov facility found for "${err.parkName}"`;
  }
  if (err instanceof RecAreaNotFoundError) {
    return `no Recreation.gov recreation area found for "${err.areaName}"`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
