import type { LlmProvider, ModelInfo, ResearchPreviewResult } from "@synthora/schemas";

/**
 * The connected provider. Lives only in React state (tab memory): never
 * written to localStorage, sessionStorage, cookies or the URL.
 */
export interface Connection {
  provider: LlmProvider;
  key: string;
  models: ModelInfo[];
  model: string;
}

export type Run =
  | { id: string; query: string; topN: number; provider: LlmProvider; model: string; startedAt: number; status: "running" }
  | {
      id: string;
      query: string;
      topN: number;
      provider: LlmProvider;
      model: string;
      startedAt: number;
      finishedAt: number;
      status: "done";
      result: ResearchPreviewResult;
    }
  | {
      id: string;
      query: string;
      topN: number;
      provider: LlmProvider;
      model: string;
      startedAt: number;
      finishedAt: number;
      status: "error" | "cancelled";
      message: string;
    };

export const PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
};
