import { z } from "zod";
import { LiteratureSource, Paper } from "./paper.js";

export const LiteratureSearchRequest = z.object({
  query: z.string().trim().min(3).max(1000),
  /** Maximum records to request from each source before deduplication. */
  limitPerSource: z.number().int().min(1).max(100).default(25),
  sources: z.array(LiteratureSource).min(1).default(["pubmed", "europepmc"]),
});
export type LiteratureSearchRequest = z.infer<typeof LiteratureSearchRequest>;

export const SourceSearchOutcome = z.discriminatedUnion("status", [
  z.object({
    source: LiteratureSource,
    status: z.literal("ok"),
    /** Total hits the source reported for the query (not just those returned). */
    totalHits: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
  }),
  z.object({
    source: LiteratureSource,
    status: z.literal("error"),
    message: z.string(),
  }),
]);
export type SourceSearchOutcome = z.infer<typeof SourceSearchOutcome>;

/**
 * Why a paper was ranked where it was. Kept on every result so rankings can
 * be explained to users and measured in evaluation.
 */
export const Relevance = z.object({
  /** Fused score (reciprocal rank fusion). Only meaningful relative to other papers in the same result. */
  score: z.number().nonnegative(),
  /** BM25 score of the query against title + abstract, within the retrieved set. */
  lexicalScore: z.number().nonnegative(),
  /** 1-based rank each source gave this paper. Absent when the source did not return it. */
  sourceRanks: z.object({
    pubmed: z.number().int().positive().optional(),
    europepmc: z.number().int().positive().optional(),
  }),
});
export type Relevance = z.infer<typeof Relevance>;

export const RankedPaper = Paper.extend({ relevance: Relevance });
export type RankedPaper = z.infer<typeof RankedPaper>;

export const LiteratureSearchResult = z.object({
  query: z.string(),
  /** Deduplicated papers, most relevant first. */
  papers: z.array(RankedPaper),
  outcomes: z.array(SourceSearchOutcome),
  /** Records received before deduplication. */
  totalRetrieved: z.number().int().nonnegative(),
});
export type LiteratureSearchResult = z.infer<typeof LiteratureSearchResult>;
