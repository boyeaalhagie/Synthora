import type { ResearchPreviewResult } from "@synthora/schemas";

/** Graded relevance: 0 not relevant, 1 partially relevant, 2 highly relevant. */
export type Judgments = Readonly<Record<string, 0 | 1 | 2>>;

export interface RetrievalMetrics {
  /** Share of the top k that are relevant (grade ≥ 1). Unjudged papers count as not relevant. */
  precisionAtK: number;
  /** Share of all known relevant papers that appear in the top k. */
  recallAtK: number;
  /** Normalised discounted cumulative gain over the top k, using graded relevance. */
  ndcgAtK: number;
  /** 1 / rank of the first relevant paper (0 if none in the list). */
  reciprocalRank: number;
  /** Retrieved papers in the top k with no judgment: a high count means the metrics are less reliable. */
  unjudgedInTopK: number;
  k: number;
}

const gain = (grade: number) => 2 ** grade - 1;
const discount = (rank: number) => 1 / Math.log2(rank + 1);

export function retrievalMetrics(rankedIds: readonly string[], judgments: Judgments, k = 10): RetrievalMetrics {
  const top = rankedIds.slice(0, k);
  const grade = (id: string) => judgments[id] ?? 0;
  const relevant = Object.entries(judgments).filter(([, g]) => g >= 1);

  const hits = top.filter((id) => grade(id) >= 1).length;
  const dcg = top.reduce((sum, id, i) => sum + gain(grade(id)) * discount(i + 1), 0);
  const ideal = relevant
    .map(([, g]) => g)
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce<number>((sum, g, i) => sum + gain(g) * discount(i + 1), 0);
  const firstHit = rankedIds.findIndex((id) => grade(id) >= 1);

  return {
    precisionAtK: top.length ? hits / k : 0,
    recallAtK: relevant.length ? hits / relevant.length : 0,
    ndcgAtK: ideal > 0 ? dcg / ideal : 0,
    reciprocalRank: firstHit === -1 ? 0 : 1 / (firstHit + 1),
    unjudgedInTopK: top.filter((id) => judgments[id] === undefined).length,
    k,
  };
}

/** A ratio that keeps its counts, so aggregates are computed from totals rather than averaged rates. */
export interface Rate {
  count: number;
  total: number;
}

export const rate = (r: Rate) => (r.total ? r.count / r.total : 0);
export const sumRates = (rs: readonly Rate[]): Rate => ({ count: rs.reduce((n, r) => n + r.count, 0), total: rs.reduce((n, r) => n + r.total, 0) });

/**
 * Reliability measured from the pipeline's own verification records. Each
 * rate is a direct count of a kind of fabrication the checks caught; low is
 * good. They need no labels, so they can run on any question.
 */
export interface ReliabilityMetrics {
  /** Extracted items whose quote was not in the abstract (or whose number was not in the quote). */
  extractionRejected: Rate;
  /** Analysis claims citing evidence that does not exist. */
  fabricatedCitations: Rate;
  /** Claims the reviewer judged unsupported by their cited quotes. */
  unsupportedClaims: Rate;
  /** Report sentences stating a number absent from their cited evidence. */
  unsupportedNumbers: Rate;
  /** Report sentences removed for any reason. */
  sentencesRejected: Rate;
}

export function reliabilityMetrics(r: ResearchPreviewResult): ReliabilityMetrics {
  let kept = 0;
  let rejected = 0;
  for (const e of r.extractions) {
    if (e.status !== "extracted") continue;
    const x = e.extraction;
    kept += [x.objective, x.studyDesign, x.population, x.sampleSize, x.dataset].filter(Boolean).length + x.methods.length + x.findings.length + x.limitations.length;
    rejected += e.rejected.length;
  }

  const a = r.analysis.status === "analyzed" ? r.analysis : null;
  const claimsKept = a ? a.findings.length + a.agreements.length + a.conflicts.length + a.gaps.length : 0;
  const claimsRejected = a?.rejected ?? [];

  const review = r.verification.claims.status === "assessed" ? r.verification.claims.assessments.filter((x) => x.verdict !== "not_assessed") : [];

  const report = r.report.status === "written" ? r.report : null;
  const written = report ? report.sections.filter((s) => !s.generated).reduce((n, s) => n + s.paragraphs.flat().length, 0) : 0;
  const removed = report?.rejected ?? [];

  return {
    extractionRejected: { count: rejected, total: kept + rejected },
    fabricatedCitations: { count: claimsRejected.filter((c) => c.reason === "unknown_evidence").length, total: claimsKept + claimsRejected.length },
    unsupportedClaims: { count: review.filter((x) => x.verdict === "unsupported").length, total: review.length },
    unsupportedNumbers: { count: removed.filter((s) => s.reason === "number_not_in_evidence").length, total: written + removed.length },
    sentencesRejected: { count: removed.length, total: written + removed.length },
  };
}

export const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
