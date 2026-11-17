import OpenAI from "openai";
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

export class OpenAiAdapter implements ProviderAdapter {
  readonly provider = "openai" as const;
  readonly #client: OpenAI;

  constructor(key: ApiKey, options: AdapterOptions = {}) {
    this.#client = new OpenAI({
      apiKey: key.reveal(),
      maxRetries: 2,
      timeout: 120_000,
      ...(options.fetch && { fetch: options.fetch }),
    });
  }

  /**
   * OpenAI's model list has no capability metadata, so it includes embedding,
   * audio and image models too. Filtering by name pattern would silently go
   * stale, so the full list is returned and choosing a text model is left to
   * the user.
   */
  async listModels(): Promise<ModelInfo[]> {
    try {
      const models: ModelInfo[] = [];
      for await (const model of this.#client.models.list({ timeout: 15_000 })) {
        models.push({ id: model.id });
      }
      return models.sort((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
      throw toProviderError(err);
    }
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    try {
      const response = await this.#client.responses.create({
        model: request.model,
        ...(request.system !== undefined && { instructions: request.system }),
        input: request.prompt,
        max_output_tokens: request.maxOutputTokens,
        // The Responses API stores responses server-side by default; research
        // content should not be retained in the user's account on our behalf.
        store: false,
      });

      return {
        text: response.output_text,
        stopReason: stopReasonOf(response),
        model: response.model,
        usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 },
      };
    } catch (err) {
      throw toProviderError(err);
    }
  }
}

function stopReasonOf(response: OpenAI.Responses.Response): StopReason {
  const refused = response.output.some(
    (item) => item.type === "message" && item.content.some((part) => part.type === "refusal"),
  );
  if (refused) return "refusal";
  if (response.status === "completed") return "end";
  if (response.status === "incomplete") {
    const reason = response.incomplete_details?.reason;
    if (reason === "max_output_tokens") return "max_tokens";
    if (reason === "content_filter") return "refusal";
  }
  return "other";
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof OpenAI.APIConnectionError) return new ProviderError("unavailable");
  if (err instanceof OpenAI.APIError) return errorFromStatus(err.status);
  return new ProviderError("unknown");
}
