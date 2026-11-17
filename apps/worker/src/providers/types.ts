import type { LlmProvider, ModelInfo, ProviderErrorKind } from "@synthora/schemas";
import type { FetchFn } from "../lib/http.js";

export interface GenerateRequest {
  model: string;
  system?: string;
  prompt: string;
  maxOutputTokens: number;
}

/**
 * - `end`: the model finished normally.
 * - `max_tokens`: output was cut off at the limit — treat the text as incomplete.
 * - `refusal`: the provider's safety systems declined. The text may be empty.
 */
export type StopReason = "end" | "max_tokens" | "refusal" | "other";

export interface GenerateResult {
  text: string;
  stopReason: StopReason;
  /** Model that actually served the request (may differ from the requested one, e.g. after a fallback). */
  model: string;
  /** Billed tokens; output includes any reasoning/thinking tokens. */
  usage: { inputTokens: number; outputTokens: number };
}

/** One provider, bound to one user's key for the lifetime of a request. */
export interface ProviderAdapter {
  readonly provider: LlmProvider;
  /** Lists models available to the key. Doubles as key verification: it costs no tokens. */
  listModels(): Promise<ModelInfo[]>;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

export interface AdapterOptions {
  /** Injected for tests. Defaults to the runtime's fetch. */
  fetch?: FetchFn;
}

/** Non-streaming requests stay under SDK HTTP timeouts at or below this. */
export const MAX_OUTPUT_TOKENS = 16_000;

const MESSAGES: Record<ProviderErrorKind, string> = {
  invalid_key: "The provider rejected this API key.",
  permission_denied: "This API key is not permitted to perform this action.",
  rate_limited: "The provider is rate-limiting this key or its quota is exhausted.",
  model_not_found: "The requested model is not available to this key.",
  bad_request: "The provider rejected the request.",
  unavailable: "The provider could not be reached. Try again shortly.",
  unknown: "An unexpected error occurred while contacting the provider.",
};

/**
 * Provider failure with a Synthora-authored message. The provider's own error
 * text is deliberately discarded: some providers echo part of the key.
 */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly status?: number,
  ) {
    super(MESSAGES[kind]);
    this.name = "ProviderError";
  }
}

export function errorFromStatus(status: number | undefined): ProviderError {
  switch (status) {
    case 401:
      return new ProviderError("invalid_key", status);
    case 403:
      return new ProviderError("permission_denied", status);
    case 404:
      return new ProviderError("model_not_found", status);
    case 429:
      return new ProviderError("rate_limited", status);
    case 400:
    case 413:
    case 422:
      return new ProviderError("bad_request", status);
    default:
      return status !== undefined && status >= 500
        ? new ProviderError("unavailable", status)
        : new ProviderError("unknown", status);
  }
}
