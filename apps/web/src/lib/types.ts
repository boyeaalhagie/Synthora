import type { LlmProvider, ModelInfo, PipelineStep, ProgressEvent, ResearchPreviewResult, SessionSummary, StepStatus } from "@synthora/schemas";

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

export const STEPS: readonly PipelineStep[] = ["plan", "search", "extract", "analyze", "verify", "report"];

export interface StepState {
  status: StepStatus | "pending";
  detail?: string;
}

/** What the pipeline has actually reported so far. */
export interface Progress {
  steps: Record<PipelineStep, StepState>;
  extract: { completed: number; total: number } | null;
}

export function initialProgress(): Progress {
  return {
    steps: { plan: { status: "pending" }, search: { status: "pending" }, extract: { status: "pending" }, analyze: { status: "pending" }, verify: { status: "pending" }, report: { status: "pending" } },
    extract: null,
  };
}

export function applyProgress(progress: Progress, event: ProgressEvent): Progress {
  if (event.type === "step") {
    return { ...progress, steps: { ...progress.steps, [event.step]: { status: event.status, ...(event.detail !== undefined && { detail: event.detail }) } } };
  }
  if (event.type === "extract") return { ...progress, extract: { completed: event.completed, total: event.total } };
  return progress;
}

interface RunBase {
  id: string;
  query: string;
  topN: number;
  provider: LlmProvider;
  model: string;
  startedAt: number;
  progress: Progress;
  /** Server-side id once the result has been saved; enables reopening and deleting it. */
  sessionId?: string;
}

export type Run =
  | (RunBase & { status: "running" })
  | (RunBase & { status: "done"; finishedAt: number; result: ResearchPreviewResult })
  | (RunBase & { status: "error" | "cancelled"; finishedAt: number; message: string })
  /** A run saved earlier; its result is fetched when it is opened. */
  | (RunBase & { status: "saved"; finishedAt: number; sessionId: string; loadError?: string });

/** A saved session as a run, for the sidebar. Its full result loads on demand. */
export function savedRun(s: SessionSummary): Run {
  const finishedAt = Date.parse(s.createdAt);
  return {
    id: s.id,
    sessionId: s.id,
    query: s.question,
    topN: s.paperCount,
    provider: s.provider,
    model: s.model,
    startedAt: finishedAt - s.durationMs,
    finishedAt,
    progress: initialProgress(),
    status: "saved",
  };
}

export const PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
};
