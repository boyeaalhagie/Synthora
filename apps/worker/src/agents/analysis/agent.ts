import { AnalysisDraft, type EvidenceAnalysisResult } from "@synthora/schemas";
import type { ProviderAdapter } from "../../providers/index.js";
import { generateStructured } from "../structured.js";
import { buildCatalog, type ExtractedPaper } from "./catalog.js";
import { analysisPrompt, PROMPT_VERSION, repairPrompt, SYSTEM_PROMPT } from "./prompt.js";
import { verifyClaims } from "./verify.js";

export interface AnalyzeOptions {
  model: string;
  maxOutputTokens?: number;
  maxAttempts?: number;
}

/** Non-streaming ceiling; analysis output is larger than a single paper's extraction. */
const DEFAULTS = { maxOutputTokens: 16_000, maxAttempts: 2 };

/**
 * Compares verified evidence across papers. The comparison tables are built
 * deterministically; the model contributes findings, agreements, conflicts
 * and gaps, each of which must cite evidence ids that are then checked.
 */
export async function analyzeEvidence(
  question: string,
  papers: readonly ExtractedPaper[],
  adapter: ProviderAdapter,
  options: AnalyzeOptions,
): Promise<EvidenceAnalysisResult> {
  const catalog = buildCatalog(papers);
  if (catalog.evidence.length === 0) return { status: "skipped", reason: "no_evidence" };

  const outcome = await generateStructured(adapter, {
    model: options.model,
    system: SYSTEM_PROMPT,
    prompt: analysisPrompt(question, catalog),
    schema: AnalysisDraft,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULTS.maxOutputTokens,
    maxAttempts: options.maxAttempts ?? DEFAULTS.maxAttempts,
    repairPrompt: (previous, problems) => repairPrompt(question, catalog, previous, problems),
  });

  if (!outcome.ok) {
    const { ok: _ok, ...failure } = outcome;
    return { status: "failed", ...catalog, ...failure };
  }

  const { sections, rejected } = verifyClaims(outcome.value, catalog.evidence);
  return {
    status: "analyzed",
    ...catalog,
    ...sections,
    rejected,
    model: outcome.model,
    promptVersion: PROMPT_VERSION,
    attempts: outcome.attempts,
    usage: outcome.usage,
  };
}
