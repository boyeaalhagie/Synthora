import {
  SupportDraft,
  type AnalysisSection,
  type ClaimAssessment,
  type ClaimSupportResult,
  type EvidenceAnalysisResult,
  type Paper,
} from "@synthora/schemas";
import type { ProviderAdapter } from "../../providers/index.js";
import { studyLabel } from "../analysis/catalog.js";
import { generateStructured } from "../structured.js";
import { PROMPT_VERSION, repairPrompt, supportPrompt, SYSTEM_PROMPT, type ClaimForReview } from "./prompt.js";

export interface VerifyOptions {
  model: string;
  maxOutputTokens?: number;
  maxAttempts?: number;
}

const DEFAULTS = { maxOutputTokens: 8_000, maxAttempts: 2 };
const SECTIONS: readonly AnalysisSection[] = ["findings", "agreements", "conflicts", "gaps"];

type Analyzed = Extract<EvidenceAnalysisResult, { status: "analyzed" }>;

interface IndexedClaim extends ClaimForReview {
  sectionKey: AnalysisSection;
  index: number;
}

/** Numbers every verified claim (C1, C2, …) and attaches the quotes it cites. */
export function claimsForReview(analysis: Analyzed, papers: readonly Paper[]): IndexedClaim[] {
  const evidence = new Map(analysis.evidence.map((e) => [e.id, e]));
  const labels = new Map(papers.map((p) => [p.id, studyLabel(p)]));
  const claims: IndexedClaim[] = [];
  for (const section of SECTIONS) {
    analysis[section].forEach((claim, index) => {
      claims.push({
        id: `C${claims.length + 1}`,
        section,
        sectionKey: section,
        index,
        statement: claim.statement,
        evidence: claim.evidence.flatMap((id) => {
          const item = evidence.get(id);
          return item ? [{ id, paperLabel: labels.get(item.paperId) ?? item.paperId, quote: item.quote }] : [];
        }),
      });
    });
  }
  return claims;
}

/** Asks the model to judge whether each claim's cited quotes support it. */
export async function assessClaimSupport(
  analysis: EvidenceAnalysisResult,
  papers: readonly Paper[],
  adapter: ProviderAdapter,
  options: VerifyOptions,
): Promise<ClaimSupportResult> {
  if (analysis.status !== "analyzed") return { status: "skipped", reason: "no_claims" };
  const claims = claimsForReview(analysis, papers);
  if (claims.length === 0) return { status: "skipped", reason: "no_claims" };

  const outcome = await generateStructured(adapter, {
    model: options.model,
    system: SYSTEM_PROMPT,
    prompt: supportPrompt(claims),
    schema: SupportDraft,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULTS.maxOutputTokens,
    maxAttempts: options.maxAttempts ?? DEFAULTS.maxAttempts,
    repairPrompt: (previous, problems) => repairPrompt(claims, previous, problems),
  });
  if (!outcome.ok) {
    const { ok: _ok, ...failure } = outcome;
    return { status: "failed", ...failure };
  }

  // First verdict per claim wins; ids the judge invented are ignored; claims it skipped are marked.
  const verdicts = new Map<string, SupportDraft["assessments"][number]>();
  for (const a of outcome.value.assessments) {
    const id = a.claimId.trim().replace(/^\[|\]$/g, "").toUpperCase();
    if (!verdicts.has(id)) verdicts.set(id, a);
  }
  const assessments: ClaimAssessment[] = claims.map((claim) => {
    const v = verdicts.get(claim.id);
    return {
      section: claim.sectionKey,
      index: claim.index,
      verdict: v?.verdict ?? "not_assessed",
      explanation: v?.explanation ?? "The reviewer did not return a verdict for this claim.",
    };
  });

  return {
    status: "assessed",
    assessments,
    model: outcome.model,
    promptVersion: PROMPT_VERSION,
    attempts: outcome.attempts,
    usage: outcome.usage,
  };
}
