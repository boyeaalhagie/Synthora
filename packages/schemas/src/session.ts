import { z } from "zod";
import { LlmProvider } from "./provider.js";
import { ResearchPreviewResult } from "./research.js";

export const SessionSummary = z.object({
  id: z.string().uuid(),
  question: z.string(),
  provider: LlmProvider,
  model: z.string(),
  /** The report's title, when one was written. */
  title: z.string().nullable(),
  paperCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const SessionRecord = SessionSummary.extend({ result: ResearchPreviewResult });
export type SessionRecord = z.infer<typeof SessionRecord>;
