import { z } from "zod";
import { ProviderErrorKind } from "./provider.js";

/**
 * Every extracted value carries a verbatim quote from the paper's title or
 * abstract. Quotes are checked deterministically against the source text, so
 * a value whose quote cannot be found is rejected rather than trusted.
 */
export const Evidenced = z.object({
  value: z.string().trim().min(1).max(500),
  quote: z.string().trim().min(1).max(1000),
});
export type Evidenced = z.infer<typeof Evidenced>;

export const StudyDesign = z.enum([
  "randomized_controlled_trial",
  "non_randomized_trial",
  "cohort",
  "case_control",
  "cross_sectional",
  "diagnostic_accuracy",
  "prediction_model",
  "systematic_review",
  "meta_analysis",
  "narrative_review",
  "case_report",
  "other",
]);
export type StudyDesign = z.infer<typeof StudyDesign>;

export const Metric = z.object({
  /** e.g. "AUC", "C-statistic", "sensitivity". */
  name: z.string().trim().min(1).max(100),
  /** As written in the paper, e.g. "0.86 (95% CI 0.84-0.88)". Must appear inside the finding's quote. */
  value: z.string().trim().min(1).max(100),
});
export type Metric = z.infer<typeof Metric>;

export const Finding = Evidenced.extend({
  metrics: z.array(Metric).max(10).default([]),
});
export type Finding = z.infer<typeof Finding>;

/** What the model is asked to return. Absent information is null or an empty list, never guessed. */
export const PaperExtraction = z.object({
  objective: Evidenced.nullable(),
  studyDesign: z.object({ category: StudyDesign, quote: z.string().trim().min(1).max(1000) }).nullable(),
  population: Evidenced.nullable(),
  sampleSize: z.object({ value: z.number().int().positive(), quote: z.string().trim().min(1).max(1000) }).nullable(),
  dataset: Evidenced.nullable(),
  /** Models, algorithms or interventions studied. */
  methods: z.array(Evidenced).max(15),
  findings: z.array(Finding).max(15),
  limitations: z.array(Evidenced).max(10),
});
export type PaperExtraction = z.infer<typeof PaperExtraction>;

export const ExtractionField = z.enum([
  "objective",
  "studyDesign",
  "population",
  "sampleSize",
  "dataset",
  "methods",
  "findings",
  "limitations",
]);
export type ExtractionField = z.infer<typeof ExtractionField>;

export const RejectedItem = z.object({
  field: ExtractionField,
  item: z.unknown(),
  reason: z.enum(["quote_too_short", "quote_not_in_source", "value_not_in_quote", "metric_not_in_quote"]),
});
export type RejectedItem = z.infer<typeof RejectedItem>;

export const ExtractionResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("extracted"),
    paperId: z.string(),
    /** Only items whose quotes were verified against the source. */
    extraction: PaperExtraction,
    /** Items the model produced that failed verification — kept for transparency and evaluation. */
    rejected: z.array(RejectedItem),
    model: z.string(),
    promptVersion: z.string(),
    attempts: z.number().int().positive(),
    usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }),
  }),
  z.object({
    status: z.literal("skipped"),
    paperId: z.string(),
    reason: z.enum(["no_abstract"]),
  }),
  z.object({
    status: z.literal("failed"),
    paperId: z.string(),
    reason: z.enum(["refusal", "truncated", "invalid_output", "provider_error"]),
    message: z.string(),
    /** Set when reason is "provider_error". */
    providerErrorKind: ProviderErrorKind.optional(),
    attempts: z.number().int().nonnegative(),
    usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }),
  }),
]);
export type ExtractionResult = z.infer<typeof ExtractionResult>;
