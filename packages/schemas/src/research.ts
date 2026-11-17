import { z } from "zod";
import { EvidenceAnalysisResult } from "./analysis.js";
import { ExtractionResult } from "./extraction.js";
import { RankedPaper, SourceSearchOutcome } from "./literature.js";
import { LlmProvider } from "./provider.js";
import { ResearchReport } from "./report.js";
import { VerificationResult } from "./verification.js";

/** Provisional single-request pipeline: search, rank, extract the top papers, then analyse across them. */
export const ResearchPreviewRequest = z.object({
  query: z.string().trim().min(3).max(1000),
  provider: LlmProvider,
  model: z.string().trim().min(1).max(200),
  /** Top-ranked papers with abstracts to extract. Each costs one or two model calls. */
  topN: z.number().int().min(1).max(10).default(5),
});
export type ResearchPreviewRequest = z.infer<typeof ResearchPreviewRequest>;

export const ResearchPreviewResult = z.object({
  query: z.string(),
  search: z.object({ outcomes: z.array(SourceSearchOutcome), totalRetrieved: z.number().int().nonnegative() }),
  papers: z.array(RankedPaper),
  extractions: z.array(ExtractionResult),
  analysis: EvidenceAnalysisResult,
  verification: VerificationResult,
  report: ResearchReport,
  /** Total tokens across extraction and analysis. */
  usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }),
});
export type ResearchPreviewResult = z.infer<typeof ResearchPreviewResult>;
