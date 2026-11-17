import { z } from "zod";
import { ProviderErrorKind } from "./provider.js";

/** One concept in the question and the interchangeable terms for it (synonyms, abbreviations, variants). */
export const PlanConcept = z.object({
  name: z.string().trim().min(1).max(80),
  terms: z.array(z.string().trim().min(2).max(80)).min(1).max(8),
});
export type PlanConcept = z.infer<typeof PlanConcept>;

const Year = z.number().int().min(1900).max(2100);

/** What the planner model returns. It never writes query syntax; code builds each source's query from this. */
export const PlanDraft = z
  .object({
    concepts: z.array(PlanConcept).min(1).max(4),
    yearFrom: Year.nullable(),
    yearTo: Year.nullable(),
  })
  .refine((p) => p.yearFrom === null || p.yearTo === null || p.yearFrom <= p.yearTo, { message: "yearFrom must not be after yearTo" });
export type PlanDraft = z.infer<typeof PlanDraft>;

export const SearchQueries = z.object({
  pubmed: z.string(),
  europepmc: z.string(),
  /** Free-text terms used for lexical (BM25) relevance ranking. */
  ranking: z.string(),
});
export type SearchQueries = z.infer<typeof SearchQueries>;

const Usage = z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() });

export const SearchPlanResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("planned"),
    concepts: z.array(PlanConcept),
    yearFrom: Year.nullable(),
    yearTo: Year.nullable(),
    queries: SearchQueries,
    model: z.string(),
    promptVersion: z.string(),
    attempts: z.number().int().positive(),
    usage: Usage,
  }),
  /** Planning failed or was disabled; the question was searched as written. */
  z.object({
    status: z.literal("fallback"),
    reason: z.string(),
    queries: SearchQueries,
    providerErrorKind: ProviderErrorKind.optional(),
    attempts: z.number().int().nonnegative(),
    usage: Usage,
  }),
]);
export type SearchPlanResult = z.infer<typeof SearchPlanResult>;
