export type FetchFn = (input: Request | string | URL, init?: RequestInit) => Promise<Response>;
export type SleepFn = (ms: number) => Promise<void>;

export const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** An upstream request failed. The message is safe to show to users: it never includes query strings. */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/**
 * Spaces requests at least `intervalMs` apart.
 *
 * Slots are reserved synchronously, so concurrent callers queue correctly.
 * On Workers this is per-isolate and therefore best-effort; a hard global
 * limit would need a Durable Object.
 */
export class MinIntervalLimiter {
  private nextSlot = 0;

  constructor(
    private readonly intervalMs: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: SleepFn = defaultSleep,
  ) {}

  async acquire(): Promise<void> {
    const now = this.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.intervalMs;
    if (slot > now) await this.sleep(slot - now);
  }
}

export interface RetryOptions {
  /** Retries after the first attempt. */
  retries: number;
  baseDelayMs: number;
  timeoutMs: number;
}

export const DEFAULT_RETRY: RetryOptions = { retries: 2, baseDelayMs: 500, timeoutMs: 15_000 };

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 10_000;

export interface FetchWithRetryDeps {
  fetch: FetchFn;
  sleep?: SleepFn;
  limiter?: MinIntervalLimiter;
  retry?: RetryOptions;
}

/**
 * GET/POST with a timeout, retries on transient failures (network errors,
 * timeouts, 408/429/5xx) using exponential backoff or `Retry-After`, and
 * optional rate limiting. Non-retryable HTTP errors fail immediately.
 */
export async function fetchWithRetry(
  url: URL,
  init: RequestInit,
  deps: FetchWithRetryDeps,
): Promise<Response> {
  const { retries, baseDelayMs, timeoutMs } = deps.retry ?? DEFAULT_RETRY;
  const sleep = deps.sleep ?? defaultSleep;
  const label = `${url.host}${url.pathname}`;

  for (let attempt = 0; ; attempt++) {
    await deps.limiter?.acquire();

    let response: Response | undefined;
    let failure: string;
    try {
      response = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return response;
      failure = `${label} responded ${response.status}`;
      if (!RETRYABLE_STATUS.has(response.status)) {
        throw new UpstreamError(failure, response.status);
      }
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      failure =
        err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
          ? `${label} timed out after ${timeoutMs}ms`
          : `${label} could not be reached`;
    }

    if (attempt >= retries) throw new UpstreamError(failure, response?.status);

    // Drain the body so the connection can be reused.
    await response?.body?.cancel();
    await sleep(retryDelay(response, attempt, baseDelayMs));
  }
}

function retryDelay(response: Response | undefined, attempt: number, baseDelayMs: number): number {
  const header = response?.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  return baseDelayMs * 2 ** attempt;
}
