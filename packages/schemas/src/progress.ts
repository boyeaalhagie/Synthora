import { z } from "zod";
import { ResearchPreviewResult } from "./research.js";

/** The pipeline's user-visible steps, in order. */
export const PipelineStep = z.enum(["plan", "search", "extract", "analyze", "verify", "report"]);
export type PipelineStep = z.infer<typeof PipelineStep>;

export const StepStatus = z.enum(["running", "done", "failed", "skipped"]);
export type StepStatus = z.infer<typeof StepStatus>;

/**
 * Events streamed (as NDJSON) while a research run executes. They are
 * emitted when the work actually happens — never simulated — so the UI's
 * progress reflects the real pipeline.
 */
export const ProgressEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("step"),
    step: PipelineStep,
    status: StepStatus,
    /** Short human-readable outcome, e.g. "50 records from 2 sources". */
    detail: z.string().optional(),
  }),
  /** Per-paper extraction progress. */
  z.object({ type: z.literal("extract"), completed: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  /** `sessionId` is set when the result was saved and can be reopened later. */
  z.object({ type: z.literal("result"), result: ResearchPreviewResult, sessionId: z.string().optional() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ProgressEvent = z.infer<typeof ProgressEvent>;

export const NDJSON = "application/x-ndjson";
