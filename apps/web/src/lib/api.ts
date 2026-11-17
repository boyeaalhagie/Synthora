import type { LlmProvider, ProgressEvent, ResearchPreviewResult, SessionRecord, SessionSummary, VerifyProviderResult } from "@synthora/schemas";
import { botToken } from "./turnstile.js";

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

async function protectedHeaders(action: "verify" | "research"): Promise<Record<string, string>> {
  try {
    const token = await botToken(action);
    return token ? { "x-turnstile-token": token } : {};
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : "The browser check failed.", 0);
  }
}

async function postJson(path: string, action: "verify" | "research", body: unknown, key: string, signal?: AbortSignal): Promise<{ status: number; data: unknown }> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      // The key travels only in this header — never in the URL or JSON body.
      headers: { "content-type": "application/json", "x-provider-key": key, ...(await protectedHeaders(action)) },
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
  const { status, data } = await postJson("/api/provider/verify", "verify", { provider }, key);
  if (typeof data === "object" && data !== null && "valid" in data) return data as VerifyProviderResult;
  throw new ApiError(errorMessage(data, status), status);
}

export interface PreviewRequest {
  query: string;
  provider: LlmProvider;
  model: string;
  topN: number;
}

/**
 * Runs the pipeline and streams its progress. `onEvent` receives every
 * progress event as the server emits it; the promise resolves with the final
 * result. Aborting `signal` closes the stream, which also stops the server
 * from making further model calls.
 */
export async function runPreviewStream(
  request: PreviewRequest,
  key: string,
  onEvent: (event: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<{ result: ResearchPreviewResult; sessionId?: string }> {
  let response: Response;
  try {
    response = await fetch("/api/research/preview", {
      method: "POST",
      headers: { "content-type": "application/json", accept: NDJSON_TYPE, "x-provider-key": key, ...(await protectedHeaders("research")) },
      body: JSON.stringify(request),
      ...(signal && { signal }),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Could not reach the Synthora server. Is the worker running (npm run dev:worker)?", 0);
  }
  if (!response.ok || !response.body) {
    const data: unknown = await response.json().catch(() => undefined);
    throw new ApiError(errorMessage(data, response.status), response.status);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as ProgressEvent;
      if (event.type === "result") return { result: event.result, ...(event.sessionId && { sessionId: event.sessionId }) };
      if (event.type === "error") throw new ApiError(event.message, 200);
      onEvent(event);
    }
    if (done) break;
  }
  throw new ApiError("The connection closed before the research finished.", 0);
}

const NDJSON_TYPE = "application/x-ndjson";

/** Saved sessions belong to this browser (an HttpOnly cookie the server sets). Resolves [] when saving is not configured. */
export async function listSessions(): Promise<SessionSummary[]> {
  const response = await fetch("/api/research").catch(() => undefined);
  if (!response?.ok) return [];
  const data = (await response.json()) as { sessions: SessionSummary[] };
  return data.sessions;
}

export async function getSession(id: string): Promise<SessionRecord> {
  const response = await fetch(`/api/research/${encodeURIComponent(id)}`);
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new ApiError(response.status === 404 ? "This saved research no longer exists." : errorMessage(data, response.status), response.status);
  return data as SessionRecord;
}

export async function deleteSession(id: string): Promise<void> {
  const response = await fetch(`/api/research/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new ApiError("Could not delete this research.", response.status);
}
