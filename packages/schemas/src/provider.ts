import { z } from "zod";

/** LLM providers a user can connect with their own API key. */
export const LlmProvider = z.enum(["anthropic", "openai", "gemini"]);
export type LlmProvider = z.infer<typeof LlmProvider>;

export const ModelInfo = z.object({
  id: z.string().min(1),
  displayName: z.string().optional(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

/**
 * Failure categories shared by every provider. Messages shown to users come
 * from Synthora, never from the provider: provider error text can echo part
 * of the key.
 */
export const ProviderErrorKind = z.enum([
  "invalid_key",
  "permission_denied",
  "rate_limited",
  "model_not_found",
  "bad_request",
  "unavailable",
  "unknown",
]);
export type ProviderErrorKind = z.infer<typeof ProviderErrorKind>;

export const VerifyProviderRequest = z.object({
  provider: LlmProvider,
});
export type VerifyProviderRequest = z.infer<typeof VerifyProviderRequest>;

export const VerifyProviderResult = z.discriminatedUnion("valid", [
  z.object({
    valid: z.literal(true),
    provider: LlmProvider,
    /** Models this key can use, as reported by the provider. */
    models: z.array(ModelInfo),
  }),
  z.object({
    valid: z.literal(false),
    provider: LlmProvider,
    error: z.object({ kind: ProviderErrorKind, message: z.string() }),
  }),
]);
export type VerifyProviderResult = z.infer<typeof VerifyProviderResult>;
