import type {
  LiteratureSearchRequest,
  LlmProvider,
  ProgressEvent,
  ResearchPreviewResult,
  SearchPlanResult,
  SourceSearchOutcome,
} from "@synthora/schemas";
import { analyzeEvidence } from "../agents/analysis/agent.js";
import { extractPapers } from "../agents/extraction/agent.js";
import { planSearch } from "../agents/planner/agent.js";
import { fallbackQueries } from "../agents/planner/queries.js";
import { synthesizeReport } from "../agents/synthesis/agent.js";
import { assessClaimSupport } from "../agents/verification/agent.js";
import { checkPapers, type CrossrefLookup } from "../agents/verification/records.js";
import { searchLiterature } from "../literature/search.js";
import type { LiteratureClient } from "../literature/types.js";
import type { AdapterFactory, ApiKey } from "../providers/index.js";

export interface PipelineDeps {
  literatureClients: readonly LiteratureClient[];
  createAdapter: AdapterFactory;
  crossref: CrossrefLookup;
}

export interface PipelineParams {
  query: string;
  provider: LlmProvider;
  model: string;
  topN: number;
  /** Set to false to search the question as written (used by the evaluation baseline). Defaults to true. */
  planner?: boolean;
}

export interface PipelineControl {
  /** Receives progress as work actually happens. */
  emit: (event: ProgressEvent) => void;
  /** Checked between steps (and before each paper); when true the run stops before spending more tokens. */
  isCancelled: () => boolean;
}

export type PipelineOutcome =
  | { ok: true; result: ResearchPreviewResult }
  | { ok: false; status: 499 | 502; error: string; outcomes?: SourceSearchOutcome[] };

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const CANCELLED = { ok: false, status: 499, error: "The run was cancelled." } as const;

/**
 * Search → rank → extract → analyse → verify → write. Every model step uses
 * the user's key; every model output is checked by code before it is used.
 */
export async function runResearch(params: PipelineParams, key: ApiKey, deps: PipelineDeps, control: PipelineControl): Promise<PipelineOutcome> {
  const { query, provider, model, topN } = params;
  const { emit, isCancelled } = control;
  const adapter = deps.createAdapter(provider, key);
  const now = new Date();

  emit({ type: "step", step: "plan", status: "running" });
  let plan: SearchPlanResult =
    params.planner === false
      ? { status: "fallback", reason: "Planning was disabled for this run.", queries: fallbackQueries(query), attempts: 0, usage: { inputTokens: 0, outputTokens: 0 } }
      : await planSearch(query, adapter, { model, now });
  emit({
    type: "step",
    step: "plan",
    status: plan.status === "planned" ? "done" : "skipped",
    detail: plan.status === "planned" ? `${plural(plan.concepts.length, "concept")}, ${plural(plan.concepts.reduce((n, c) => n + c.terms.length, 0), "search term")}` : `Searching the question as written: ${plan.reason}`,
  });
  if (isCancelled()) return CANCELLED;

  emit({ type: "step", step: "search", status: "running" });
  const searchRequest: LiteratureSearchRequest = { query, limitPerSource: 25, sources: ["pubmed", "europepmc"] };
  let search = await searchLiterature(searchRequest, deps.literatureClients, plan.queries);
  // A plan can be too narrow. Rather than return nothing, fall back to the question as written.
  if (plan.status === "planned" && !search.papers.some((p) => p.abstract)) {
    plan = { status: "fallback", reason: "The planned search found no papers with abstracts.", queries: fallbackQueries(query), attempts: plan.attempts, usage: plan.usage };
    search = await searchLiterature(searchRequest, deps.literatureClients, plan.queries);
  }
  if (search.outcomes.every((o) => o.status === "error")) {
    emit({ type: "step", step: "search", status: "failed", detail: "PubMed and Europe PMC could not be searched." });
    return { ok: false, status: 502, error: "Literature search failed", outcomes: search.outcomes };
  }
  // Papers without abstracts cannot be extracted; take the best-ranked ones that have one.
  const papers = search.papers.filter((p) => p.abstract).slice(0, topN);
  const sources = search.outcomes.filter((o) => o.status === "ok").length;
  emit({
    type: "step",
    step: "search",
    status: "done",
    detail: `${plural(search.totalRetrieved, "record")} from ${plural(sources, "source")}; top ${papers.length} selected`,
  });
  if (isCancelled()) return CANCELLED;
  // Record checks (Crossref, retraction flags) need no model, so they run alongside the model steps.
  const recordChecks = checkPapers(papers, deps.crossref);

  emit({ type: "step", step: "extract", status: "running", detail: `0 of ${papers.length} papers` });
  emit({ type: "extract", completed: 0, total: papers.length });
  const extractions = await extractPapers(papers, adapter, {
    model,
    shouldStop: isCancelled,
    onProgress: (completed, total) => emit({ type: "extract", completed, total }),
  });
  if (isCancelled()) return CANCELLED;
  const extractedCount = extractions.filter((e) => e.status === "extracted").length;
  const firstFailure = extractions.find((e) => e.status === "failed");
  emit({
    type: "step",
    step: "extract",
    status: extractedCount > 0 ? "done" : "failed",
    detail:
      extractedCount > 0
        ? `${extractedCount} of ${plural(papers.length, "paper")} extracted`
        : firstFailure?.status === "failed"
          ? firstFailure.message
          : "No papers could be extracted.",
  });

  // Analysis sees only verified evidence; with none it is skipped without a model call.
  const extracted = extractions.flatMap((e, i) => (e.status === "extracted" ? [{ paper: papers[i]!, extraction: e.extraction }] : []));
  emit({ type: "step", step: "analyze", status: "running" });
  const analysis = await analyzeEvidence(query, extracted, adapter, { model });
  emit({
    type: "step",
    step: "analyze",
    ...(analysis.status === "analyzed"
      ? { status: "done", detail: `${plural(analysis.evidence.length, "evidence item")}, ${plural(analysis.findings.length + analysis.agreements.length + analysis.conflicts.length + analysis.gaps.length, "claim")}` }
      : analysis.status === "skipped"
        ? { status: "skipped", detail: "No verified evidence to analyse." }
        : { status: "failed", detail: analysis.message }),
  });
  if (isCancelled()) return CANCELLED;

  emit({ type: "step", step: "verify", status: "running" });
  const claims = await assessClaimSupport(analysis, papers, adapter, { model });
  const verification = { papers: await recordChecks, claims };
  const withDoi = verification.papers.filter((c) => c.crossref !== "no_doi");
  const doiDetail = `${withDoi.filter((c) => c.crossref === "match").length} of ${plural(withDoi.length, "DOI")} confirmed`;
  emit({
    type: "step",
    step: "verify",
    ...(claims.status === "assessed"
      ? {
          status: "done",
          detail: `${doiDetail}; ${claims.assessments.filter((a) => a.verdict === "supported").length} of ${plural(claims.assessments.length, "claim")} fully supported`,
        }
      : claims.status === "skipped"
        ? { status: "done", detail: doiDetail }
        : { status: "failed", detail: claims.message }),
  });
  if (isCancelled()) return CANCELLED;

  // The report needs the verdicts and record checks: it drops unsupported claims and excludes retracted papers' evidence.
  emit({ type: "step", step: "report", status: "running" });
  const report = await synthesizeReport({ question: query, plan, search, papers, extractions, analysis, verification, now }, adapter, { model });
  emit({
    type: "step",
    step: "report",
    ...(report.status === "written"
      ? {
          status: "done",
          detail: `${plural(report.sections.filter((s) => !s.generated).reduce((n, s) => n + s.paragraphs.flat().length, 0), "cited sentence")}, ${plural(report.references.length, "reference")}`,
        }
      : report.status === "skipped"
        ? { status: "skipped", detail: report.reason === "no_analysis" ? "Nothing was analysed." : "No claims survived review." }
        : { status: "failed", detail: report.message }),
  });

  const usage = { inputTokens: plan.usage.inputTokens, outputTokens: plan.usage.outputTokens };
  for (const step of [...extractions, analysis, claims, report]) {
    if (step.status === "skipped") continue;
    usage.inputTokens += step.usage.inputTokens;
    usage.outputTokens += step.usage.outputTokens;
  }

  return {
    ok: true,
    result: {
      query,
      plan,
      search: { outcomes: search.outcomes, totalRetrieved: search.totalRetrieved },
      papers,
      extractions,
      analysis,
      verification,
      report,
      usage,
    },
  };
}
