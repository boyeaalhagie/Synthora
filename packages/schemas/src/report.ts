import { z } from "zod";
import { StudySummary } from "./analysis.js";
import { ProviderErrorKind } from "./provider.js";

/** One sentence as the model writes it: text plus the evidence ids it rests on. */
export const DraftSentence = z.object({
  text: z.string().trim().min(1).max(1000),
  evidence: z.array(z.string().trim()).max(10),
});
export type DraftSentence = z.infer<typeof DraftSentence>;

const Paragraphs = (max: number) => z.array(z.array(DraftSentence).min(1).max(8)).max(max);

/** What the model is asked to return. */
export const ReportDraft = z.object({
  title: z.string().trim().min(5).max(200),
  summary: Paragraphs(2),
  findings: Paragraphs(6),
  comparison: Paragraphs(4),
  limitations: Paragraphs(3),
  gaps: Paragraphs(3),
});
export type ReportDraft = z.infer<typeof ReportDraft>;

export const ReportSectionId = z.enum(["summary", "methods", "findings", "comparison", "limitations", "gaps", "reviewLimitations"]);
export type ReportSectionId = z.infer<typeof ReportSectionId>;

export const ReportSentence = z.object({
  text: z.string(),
  /** Evidence ids the sentence cites. Empty only in sections Synthora writes itself. */
  evidence: z.array(z.string()),
  /** Reference-list numbers of the papers behind that evidence, for [1]-style citations. */
  references: z.array(z.number().int().positive()),
});
export type ReportSentence = z.infer<typeof ReportSentence>;

export const ReportSection = z.object({
  id: ReportSectionId,
  title: z.string(),
  /** True for sections composed by code from pipeline facts rather than written by the model. */
  generated: z.boolean(),
  paragraphs: z.array(z.array(ReportSentence)),
});
export type ReportSection = z.infer<typeof ReportSection>;

export const Reference = z.object({
  number: z.number().int().positive(),
  paperId: z.string(),
  /** Vancouver-style citation built from source metadata. */
  citation: z.string(),
  doi: z.string().optional(),
  pmid: z.string().optional(),
});
export type Reference = z.infer<typeof Reference>;

export const RejectedSentence = z.object({
  section: ReportSectionId,
  sentence: DraftSentence,
  reason: z.enum(["no_evidence", "unknown_evidence", "number_not_in_evidence"]),
  /** For number_not_in_evidence: the numbers that could not be found. */
  detail: z.string().optional(),
});
export type RejectedSentence = z.infer<typeof RejectedSentence>;

const Usage = z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() });

export const ResearchReport = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("written"),
    title: z.string(),
    question: z.string(),
    generatedAt: z.string(),
    sections: z.array(ReportSection),
    studies: z.array(StudySummary),
    references: z.array(Reference),
    rejected: z.array(RejectedSentence),
    /** The whole report as Markdown, for export. */
    markdown: z.string(),
    model: z.string(),
    promptVersion: z.string(),
    attempts: z.number().int().positive(),
    usage: Usage,
  }),
  z.object({ status: z.literal("skipped"), reason: z.enum(["no_analysis", "no_supported_claims"]) }),
  z.object({
    status: z.literal("failed"),
    reason: z.enum(["refusal", "truncated", "invalid_output", "provider_error"]),
    message: z.string(),
    providerErrorKind: ProviderErrorKind.optional(),
    attempts: z.number().int().nonnegative(),
    usage: Usage,
  }),
]);
export type ResearchReport = z.infer<typeof ResearchReport>;
