import Anthropic from "@anthropic-ai/sdk";
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

/**
 * Models that accept server-side refusal fallbacks. When one of them declines
 * (e.g. a classifier false positive on clinical text), the API reruns the
 * request on a suitable fallback model within the same call instead of
 * returning an empty refusal.
 */
const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class AnthropicAdapter implements ProviderAdapter {
  readonly provider = "anthropic" as const;
  readonly #client: Anthropic;

  constructor(key: ApiKey, options: AdapterOptions = {}) {
    this.#client = new Anthropic({
      apiKey: key.reveal(),
      maxRetries: 2,
      timeout: 120_000,
      ...(options.fetch && { fetch: options.fetch }),
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const models: ModelInfo[] = [];
      for await (const model of this.#client.models.list({ limit: 100 }, { timeout: 15_000 })) {
        models.push({ id: model.id, displayName: model.display_name });
      }
      return models;
    } catch (err) {
      throw toProviderError(err);
    }
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    try {
      // Thinking, effort and sampling are left at model defaults: current
      // models reject disabled thinking and sampling parameters.
      const response = await this.#client.beta.messages.create({
        model: request.model,
        max_tokens: request.maxOutputTokens,
        ...(request.system !== undefined && { system: request.system }),
        messages: [{ role: "user", content: request.prompt }],
        ...(FALLBACK_MODELS.has(request.model) && { betas: [FALLBACK_BETA], fallbacks: "default" as const }),
      });

      return {
        text: response.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join(""),
        stopReason: mapStopReason(response.stop_reason),
        model: response.model,
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    } catch (err) {
      throw toProviderError(err);
    }
  }
}

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  // Timeout errors subclass APIConnectionError.
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError("unavailable");
  if (err instanceof Anthropic.APIError) return errorFromStatus(err.status);
  return new ProviderError("unknown");
}
