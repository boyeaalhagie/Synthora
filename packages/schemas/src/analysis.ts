import { z } from "zod";
import { ExtractionField, StudyDesign } from "./extraction.js";
import { ProviderErrorKind } from "./provider.js";

/**
 * One verified extracted item, given a stable id ("E1", "E2", ...) that
 * analysis claims must cite. Built deterministically from extractions.
 */
export const EvidenceItem = z.object({
  id: z.string().regex(/^E\d+$/),
  paperId: z.string(),
  field: ExtractionField,
  value: z.string(),
  quote: z.string(),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

export const StudyMetric = z.object({ name: z.string(), value: z.string(), evidenceId: z.string() });

/** Deterministic per-study row for side-by-side comparison. */
export const StudySummary = z.object({
  paperId: z.string(),
  /** Short label, e.g. "Oikonomou 2023". */
  label: z.string(),
  title: z.string(),
  year: z.number().int().optional(),
  design: StudyDesign.optional(),
  sampleSize: z.number().int().positive().optional(),
  dataset: z.string().optional(),
  methods: z.array(z.string()),
  metrics: z.array(StudyMetric),
});
export type StudySummary = z.infer<typeof StudySummary>;

/**
 * The same metric reported across studies. Values are grouped by metric name
 * only; studies may measure different outcomes or populations, so entries
 * are not directly comparable without reading their evidence.
 */
export const MetricGroup = z.object({
  metric: z.string(),
  entries: z.array(
    z.object({
      paperId: z.string(),
      value: z.string(),
      /** First number in the value (e.g. 0.86 from "0.86 (95% CI 0.84-0.88)"), for sorting. */
      point: z.number().optional(),
      evidenceId: z.string(),
    }),
  ),
});
export type MetricGroup = z.infer<typeof MetricGroup>;

export const Claim = z.object({
  statement: z.string().trim().min(1).max(1000),
  /** Evidence ids supporting the claim. */
  evidence: z.array(z.string().trim()).min(1).max(20),
});
export type Claim = z.infer<typeof Claim>;

/** What the model is asked to return. */
export const AnalysisDraft = z.object({
  findings: z.array(Claim).max(20),
  agreements: z.array(Claim).max(10),
  conflicts: z.array(Claim).max(10),
  gaps: z.array(Claim).max(10),
});
export type AnalysisDraft = z.infer<typeof AnalysisDraft>;

export const AnalysisSection = z.enum(["findings", "agreements", "conflicts", "gaps"]);
export type AnalysisSection = z.infer<typeof AnalysisSection>;

/** A claim whose citations were checked, with the papers they resolve to. */
export const VerifiedClaim = Claim.extend({ paperIds: z.array(z.string()).min(1) });
export type VerifiedClaim = z.infer<typeof VerifiedClaim>;

export const RejectedClaim = z.object({
  section: AnalysisSection,
  claim: Claim,
  reason: z.enum(["unknown_evidence", "needs_multiple_papers"]),
});
export type RejectedClaim = z.infer<typeof RejectedClaim>;

const Usage = z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() });

export const EvidenceAnalysisResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("analyzed"),
    evidence: z.array(EvidenceItem),
    studies: z.array(StudySummary),
    metrics: z.array(MetricGroup),
    findings: z.array(VerifiedClaim),
    agreements: z.array(VerifiedClaim),
    conflicts: z.array(VerifiedClaim),
    gaps: z.array(VerifiedClaim),
    rejected: z.array(RejectedClaim),
    model: z.string(),
    promptVersion: z.string(),
    attempts: z.number().int().positive(),
    usage: Usage,
  }),
  z.object({
    status: z.literal("skipped"),
    reason: z.literal("no_evidence"),
  }),
  z.object({
    status: z.literal("failed"),
    /** The deterministic parts are still returned when the model step fails. */
    evidence: z.array(EvidenceItem),
    studies: z.array(StudySummary),
    metrics: z.array(MetricGroup),
    reason: z.enum(["refusal", "truncated", "invalid_output", "provider_error"]),
    message: z.string(),
    providerErrorKind: ProviderErrorKind.optional(),
    attempts: z.number().int().nonnegative(),
    usage: Usage,
  }),
]);
export type EvidenceAnalysisResult = z.infer<typeof EvidenceAnalysisResult>;
