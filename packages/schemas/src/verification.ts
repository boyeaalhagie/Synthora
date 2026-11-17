import { z } from "zod";
import { AnalysisSection } from "./analysis.js";
import { ProviderErrorKind } from "./provider.js";

/**
 * Result of checking a paper's DOI against Crossref.
 * - match: Crossref's registered title agrees with the source record.
 * - mismatch: the DOI resolves to a different title, so the identifier may be wrong.
 * - not_in_crossref: Crossref has no record. Not proof of a bad DOI: some
 *   DOIs are registered with other agencies (e.g. DataCite).
 * - no_doi: nothing to check.
 * - error: Crossref could not be reached.
 */
export const CrossrefStatus = z.enum(["match", "mismatch", "not_in_crossref", "no_doi", "error"]);
export type CrossrefStatus = z.infer<typeof CrossrefStatus>;

export const PaperCheck = z.object({
  paperId: z.string(),
  crossref: CrossrefStatus,
  /** Registered title, when Crossref returned one. */
  crossrefTitle: z.string().optional(),
  crossrefYear: z.number().int().optional(),
  /** Title similarity in [0, 1], when a comparison was made. */
  titleSimilarity: z.number().min(0).max(1).optional(),
  /** PubMed / Europe PMC mark the record as retracted. */
  retracted: z.boolean(),
  /** Not peer reviewed. */
  preprint: z.boolean(),
});
export type PaperCheck = z.infer<typeof PaperCheck>;

export const SupportVerdict = z.enum(["supported", "partially_supported", "unsupported"]);
export type SupportVerdict = z.infer<typeof SupportVerdict>;

/** What the judge model returns. */
export const SupportDraft = z.object({
  assessments: z
    .array(
      z.object({
        claimId: z.string().trim().min(1),
        verdict: SupportVerdict,
        explanation: z.string().trim().min(1).max(600),
      }),
    )
    .max(80),
});
export type SupportDraft = z.infer<typeof SupportDraft>;

export const ClaimAssessment = z.object({
  section: AnalysisSection,
  /** Position of the claim within its section of the analysis. */
  index: z.number().int().nonnegative(),
  /** "not_assessed" when the judge skipped the claim. */
  verdict: z.union([SupportVerdict, z.literal("not_assessed")]),
  explanation: z.string(),
});
export type ClaimAssessment = z.infer<typeof ClaimAssessment>;

const Usage = z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() });

export const ClaimSupportResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("assessed"),
    assessments: z.array(ClaimAssessment),
    model: z.string(),
    promptVersion: z.string(),
    attempts: z.number().int().positive(),
    usage: Usage,
  }),
  z.object({ status: z.literal("skipped"), reason: z.literal("no_claims") }),
  z.object({
    status: z.literal("failed"),
    reason: z.enum(["refusal", "truncated", "invalid_output", "provider_error"]),
    message: z.string(),
    providerErrorKind: ProviderErrorKind.optional(),
    attempts: z.number().int().nonnegative(),
    usage: Usage,
  }),
]);
export type ClaimSupportResult = z.infer<typeof ClaimSupportResult>;

export const VerificationResult = z.object({
  papers: z.array(PaperCheck),
  claims: ClaimSupportResult,
});
export type VerificationResult = z.infer<typeof VerificationResult>;
