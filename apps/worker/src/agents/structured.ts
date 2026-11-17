import type { ProviderErrorKind } from "@synthora/schemas";
import type { z } from "zod";
import { ProviderError, type ProviderAdapter } from "../providers/index.js";

export type FailureReason = "refusal" | "truncated" | "invalid_output" | "provider_error";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type StructuredOutcome<T> =
  | { ok: true; value: T; model: string; attempts: number; usage: Usage }
  | {
      ok: false;
      reason: FailureReason;
      message: string;
      providerErrorKind?: ProviderErrorKind;
      attempts: number;
      usage: Usage;
    };

export interface StructuredRequest<T> {
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Includes any thinking tokens on reasoning models. */
  maxOutputTokens: number;
  /** Total model calls, including repair attempts. */
  maxAttempts: number;
  /** Builds the follow-up prompt after output that failed to parse or validate. */
  repairPrompt: (previousOutput: string, problems: string[]) => string;
}

type ParseOutcome<T> = { ok: true; value: T } | { ok: false; problems: string[] };

/** Parses a JSON object out of model output, tolerating code fences or stray prose around it. */
export function parseStructured<T>(text: string, schema: z.ZodType<T>): ParseOutcome<T> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return { ok: false, problems: ["The response did not contain a JSON object."] };

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false, problems: ["The response was not valid JSON."] };
  }

  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    problems: parsed.error.issues
      .slice(0, 10)
      .map((issue) => `${issue.path.length ? issue.path.join(".") : "(root)"}: ${issue.message}`),
  };
}

/**
 * Asks the model for JSON matching `schema`, retrying with the validation
 * problems fed back until it succeeds or attempts run out. Never throws:
 * every failure is returned with the tokens it consumed.
 */
export async function generateStructured<T>(adapter: ProviderAdapter, request: StructuredRequest<T>): Promise<StructuredOutcome<T>> {
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let prompt = request.prompt;
  let attempts = 0;

  const failed = (reason: FailureReason, message: string, error?: ProviderError): StructuredOutcome<T> => ({
    ok: false,
    reason,
    message,
    ...(error && { providerErrorKind: error.kind }),
    attempts,
    usage,
  });

  while (attempts < request.maxAttempts) {
    attempts++;
    let result;
    try {
      result = await adapter.generate({
        model: request.model,
        system: request.system,
        prompt,
        maxOutputTokens: request.maxOutputTokens,
      });
    } catch (err) {
      const error = err instanceof ProviderError ? err : new ProviderError("unknown");
      return failed("provider_error", error.message, error);
    }
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;

    if (result.stopReason === "refusal") return failed("refusal", "The model declined this request.");
    if (result.stopReason === "max_tokens") return failed("truncated", "The model's output was cut off before it finished.");

    const parsed = parseStructured(result.text, request.schema);
    if (parsed.ok) return { ok: true, value: parsed.value, model: result.model, attempts, usage };
    prompt = request.repairPrompt(result.text, parsed.problems);
  }

  return failed("invalid_output", "The model did not return valid output.");
}

/** Errors that will fail every later call the same way, so further calls are pointless. */
export const FATAL_PROVIDER_ERRORS: ReadonlySet<ProviderErrorKind> = new Set(["invalid_key", "permission_denied", "model_not_found"]);
