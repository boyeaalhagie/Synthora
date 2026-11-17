import { ApiError, FinishReason, GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import type { ModelInfo } from "@synthora/schemas";
import type { ApiKey } from "./api-key.js";
import {
  errorFromStatus,
  ProviderError,
  type AdapterOptions,
  type GenerateRequest,
  type GenerateResult,
  type ProviderAdapter,
  type StopReason,
} from "./types.js";

const MODEL_PREFIX = "models/";

/** Finish reasons meaning a safety or policy system stopped generation. */
const REFUSAL_REASONS = new Set<FinishReason | undefined>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
]);

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = "gemini" as const;
  readonly #client: GoogleGenAI;

  constructor(key: ApiKey, options: AdapterOptions = {}) {
    // The SDK sends the key in the x-goog-api-key header, never as a ?key= URL parameter.
    this.#client = new GoogleGenAI({
      apiKey: key.reveal(),
      httpOptions: { timeout: 120_000, ...(options.fetch && { fetch: options.fetch }) },
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const models: ModelInfo[] = [];
      const pager = await this.#client.models.list({ config: { pageSize: 100 } });
      for await (const model of pager) {
        if (!model.name || !model.supportedActions?.includes("generateContent")) continue;
        const id = model.name.startsWith(MODEL_PREFIX) ? model.name.slice(MODEL_PREFIX.length) : model.name;
        models.push({ id, ...(model.displayName && { displayName: model.displayName }) });
      }
      return models;
    } catch (err) {
      // Google reports an invalid key as 400 INVALID_ARGUMENT rather than 401.
      // Listing models sends no user input, so a 400 here can only mean the key.
      if (err instanceof ApiError && err.status === 400) throw new ProviderError("invalid_key", 400);
      throw toProviderError(err);
    }
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    try {
      const response = await this.#client.models.generateContent({
        model: request.model,
        contents: request.prompt,
        config: {
          maxOutputTokens: request.maxOutputTokens,
          ...(request.system !== undefined && { systemInstruction: request.system }),
        },
      });
      const usage = response.usageMetadata;
      return {
        text: response.text ?? "",
        stopReason: stopReasonOf(response),
        model: response.modelVersion ?? request.model,
        usage: {
          inputTokens: usage?.promptTokenCount ?? 0,
          // Thinking tokens are billed as output.
          outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
        },
      };
    } catch (err) {
      throw toProviderError(err);
    }
  }
}

function stopReasonOf(response: GenerateContentResponse): StopReason {
  if (response.promptFeedback?.blockReason) return "refusal";
  const reason = response.candidates?.[0]?.finishReason;
  if (reason === FinishReason.STOP) return "end";
  if (reason === FinishReason.MAX_TOKENS) return "max_tokens";
  if (REFUSAL_REASONS.has(reason)) return "refusal";
  return "other";
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof ApiError) return errorFromStatus(err.status);
  // The SDK surfaces network failures and timeouts as plain errors from fetch.
  if (err instanceof TypeError || (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"))) {
    return new ProviderError("unavailable");
  }
  return new ProviderError("unknown");
}
