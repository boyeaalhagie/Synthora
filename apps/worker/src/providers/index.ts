import type { LlmProvider } from "@synthora/schemas";
import { AnthropicAdapter } from "./anthropic.js";
import type { ApiKey } from "./api-key.js";
import { GeminiAdapter } from "./gemini.js";
import { OpenAiAdapter } from "./openai.js";
import type { AdapterOptions, ProviderAdapter } from "./types.js";

export type AdapterFactory = (provider: LlmProvider, key: ApiKey) => ProviderAdapter;

/** Creates a fresh adapter per request: adapters hold the user's key and must never be cached or shared. */
export function createAdapter(provider: LlmProvider, key: ApiKey, options: AdapterOptions = {}): ProviderAdapter {
  switch (provider) {
    case "anthropic":
      return new AnthropicAdapter(key, options);
    case "openai":
      return new OpenAiAdapter(key, options);
    case "gemini":
      return new GeminiAdapter(key, options);
  }
}

export { ApiKey, PROVIDER_KEY_HEADER } from "./api-key.js";
export { MAX_OUTPUT_TOKENS, ProviderError } from "./types.js";
export type { GenerateRequest, GenerateResult, ProviderAdapter, StopReason } from "./types.js";
