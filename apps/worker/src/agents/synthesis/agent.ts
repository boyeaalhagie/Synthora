import {
  ReportDraft,
  type EvidenceAnalysisResult,
  type ExtractionResult,
  type Paper,
  type Reference,
  type RejectedSentence,
  type ReportSection,
  type ReportSectionId,
  type ResearchReport,
  type SourceSearchOutcome,
  type VerificationResult,
} from "@synthora/schemas";
import type { ProviderAdapter } from "../../providers/index.js";
import { generateStructured } from "../structured.js";
import { checkParagraphs, type CheckContext } from "./check.js";
import { buildReference, methodsParagraphs, reviewLimitationParagraphs, type PipelineFacts } from "./facts.js";
import { renderMarkdown } from "./markdown.js";
import { PROMPT_VERSION, repairPrompt, synthesisPrompt, SYSTEM_PROMPT, type ClaimForPrompt } from "./prompt.js";

export interface SynthesisInput {
  question: string;
  search: { outcomes: readonly SourceSearchOutcome[]; totalRetrieved: number };
  papers: readonly Paper[];
  extractions: readonly ExtractionResult[];
  analysis: EvidenceAnalysisResult;
  verification: VerificationResult;
  now: Date;
}

export interface SynthesisOptions {
  model: string;
  maxOutputTokens?: number;
  maxAttempts?: number;
}

const DEFAULTS = { maxOutputTokens: 16_000, maxAttempts: 2 };

/** Display order; `generated` sections are composed by code, the rest are model-written and checked. */
const SECTIONS: ReadonlyArray<{ id: ReportSectionId; title: string; generated: boolean }> = [
  { id: "summary", title: "Executive summary", generated: false },
  { id: "methods", title: "Methods", generated: true },
  { id: "findings", title: "Findings", generated: false },
  { id: "comparison", title: "Comparative analysis", generated: false },
  { id: "limitations", title: "Limitations of the evidence", generated: false },
  { id: "gaps", title: "Research gaps", generated: false },
  { id: "reviewLimitations", title: "Limitations of this review", generated: true },
];

type Analyzed = Extract<EvidenceAnalysisResult, { status: "analyzed" }>;

/** Claims the reviewer did not reject, minus any resting on excluded (retracted) evidence. */
function usableClaims(analysis: Analyzed, verification: VerificationResult, excludedEvidence: ReadonlySet<string>): ClaimForPrompt[] {
  const verdicts = new Map(
    verification.claims.status === "assessed" ? verification.claims.assessments.map((a) => [`${a.section}:${a.index}`, a]) : [],
  );
  const claims: ClaimForPrompt[] = [];
  for (const section of ["findings", "agreements", "conflicts", "gaps"] as const) {
    analysis[section].forEach((claim, index) => {
      const assessment = verdicts.get(`${section}:${index}`);
      if (assessment?.verdict === "unsupported") return;
      if (claim.evidence.some((id) => excludedEvidence.has(id))) return;
      claims.push({
        section,
        statement: claim.statement,
        evidence: claim.evidence,
        verdict: assessment?.verdict ?? "not_assessed",
        ...(assessment?.verdict === "partially_supported" && { note: assessment.explanation }),
      });
    });
  }
  return claims;
}

/**
 * Writes the final report. Methods, review limitations and references are
 * composed by code from what the pipeline did; the narrative sections are
 * written by the model and every sentence is checked for valid citations and
 * for numbers that actually appear in the evidence it cites.
 */
export async function synthesizeReport(input: SynthesisInput, adapter: ProviderAdapter, options: SynthesisOptions): Promise<ResearchReport> {
  const { analysis, verification } = input;
  if (analysis.status !== "analyzed") return { status: "skipped", reason: "no_analysis" };

  const retracted = new Set(verification.papers.filter((c) => c.retracted).map((c) => c.paperId));
  const evidence = analysis.evidence.filter((e) => !retracted.has(e.paperId));
  const excludedEvidence = new Set(analysis.evidence.filter((e) => retracted.has(e.paperId)).map((e) => e.id));
  const claims = usableClaims(analysis, verification, excludedEvidence);
  if (claims.length === 0) return { status: "skipped", reason: "no_supported_claims" };

  const studies = analysis.studies.filter((s) => !retracted.has(s.paperId));
  const preprints = new Set(verification.papers.filter((c) => c.preprint).map((c) => c.paperId));
  const prompt = synthesisPrompt(
    input.question,
    studies.map((study, i) => ({ number: i + 1, study, preprint: preprints.has(study.paperId) })),
    claims,
    evidence,
  );

  const outcome = await generateStructured(adapter, {
    model: options.model,
    system: SYSTEM_PROMPT,
    prompt,
    schema: ReportDraft,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULTS.maxOutputTokens,
    maxAttempts: options.maxAttempts ?? DEFAULTS.maxAttempts,
    repairPrompt: (previous, problems) => repairPrompt(prompt, previous, problems),
  });
  if (!outcome.ok) {
    const { ok: _ok, ...failure } = outcome;
    return { status: "failed", ...failure };
  }

  const draft = outcome.value;
  const ctx: CheckContext = {
    evidence: new Map(evidence.map((e) => [e.id, e])),
    paperYears: new Map(input.papers.flatMap((p) => (p.year !== undefined ? [[p.id, p.year] as const] : []))),
  };
  const rejected: RejectedSentence[] = [];
  const checked: Partial<Record<ReportSectionId, Array<Array<{ text: string; evidence: string[] }>>>> = {};
  for (const id of ["summary", "findings", "comparison", "limitations", "gaps"] as const) {
    checked[id] = checkParagraphs(id, draft[id], ctx, rejected);
  }

  // Reference numbers follow the order papers are first cited in the report.
  const papersById = new Map(input.papers.map((p) => [p.id, p]));
  const refNumber = new Map<string, number>();
  const references: Reference[] = [];
  const referencesFor = (ids: readonly string[]): number[] => {
    const numbers = ids.map((id) => {
      const paperId = ctx.evidence.get(id)!.paperId;
      let n = refNumber.get(paperId);
      if (n === undefined) {
        n = references.length + 1;
        refNumber.set(paperId, n);
        references.push(buildReference(n, papersById.get(paperId)!));
      }
      return n;
    });
    return [...new Set(numbers)].sort((a, b) => a - b);
  };

  const facts: PipelineFacts = {
    question: input.question,
    date: input.now.toISOString().slice(0, 10),
    search: input.search,
    papers: input.papers,
    extractions: input.extractions,
    analysis,
    verification,
    model: outcome.model,
    excludedPaperIds: retracted,
  };
  const generated: Partial<Record<ReportSectionId, string[][]>> = {
    methods: methodsParagraphs(facts),
    reviewLimitations: reviewLimitationParagraphs(facts),
  };

  const sections: ReportSection[] = SECTIONS.map(({ id, title, generated: isGenerated }) => ({
    id,
    title,
    generated: isGenerated,
    paragraphs: isGenerated
      ? (generated[id] ?? []).map((p) => p.map((text) => ({ text, evidence: [], references: [] })))
      : (checked[id] ?? []).map((p) => p.map((s) => ({ ...s, references: referencesFor(s.evidence) }))),
  }));

  const generatedAt = input.now.toISOString();
  return {
    status: "written",
    title: draft.title,
    question: input.question,
    generatedAt,
    sections,
    studies,
    references,
    rejected,
    markdown: renderMarkdown({ title: draft.title, question: input.question, generatedAt, paperCount: input.papers.length, sections, studies, references }),
    model: outcome.model,
    promptVersion: PROMPT_VERSION,
    attempts: outcome.attempts,
    usage: outcome.usage,
  };
}
