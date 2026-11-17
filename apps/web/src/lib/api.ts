import type { LlmProvider, ResearchPreviewResult, VerifyProviderResult } from "@synthora/schemas";

/** An API failure with a message safe to show (the server never echoes keys). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function postJson(path: string, body: unknown, key: string, signal?: AbortSignal): Promise<{ status: number; data: unknown }> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      // The key travels only in this header — never in the URL or JSON body.
      headers: { "content-type": "application/json", "x-provider-key": key },
      body: JSON.stringify(body),
      ...(signal && { signal }),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Could not reach the Synthora server. Is the worker running (npm run dev:worker)?", 0);
  }
  const data: unknown = await response.json().catch(() => undefined);
  return { status: response.status, data };
}

function errorMessage(data: unknown, status: number): string {
  if (typeof data === "object" && data !== null && "error" in data && typeof data.error === "string") return data.error;
  if (status === 502 || status === 504) return "The Synthora server could not reach an upstream service. Is the worker running?";
  return `Request failed (HTTP ${status}).`;
}

/** Verifies a key by listing the provider's models. Resolves with valid:false for rejected keys. */
export async function verifyProvider(provider: LlmProvider, key: string): Promise<VerifyProviderResult> {
  const { status, data } = await postJson("/api/provider/verify", { provider }, key);
  if (typeof data === "object" && data !== null && "valid" in data) return data as VerifyProviderResult;
  throw new ApiError(errorMessage(data, status), status);
}

export interface PreviewRequest {
  query: string;
  provider: LlmProvider;
  model: string;
  topN: number;
}

export async function runPreview(request: PreviewRequest, key: string, signal?: AbortSignal): Promise<ResearchPreviewResult> {
  const { status, data } = await postJson("/api/research/preview", request, key, signal);
  if (status === 200) return data as ResearchPreviewResult;
  throw new ApiError(errorMessage(data, status), status);
}
