import type { EvidenceItem, MetricGroup, Paper, PaperExtraction, StudySummary } from "@synthora/schemas";

export interface ExtractedPaper {
  paper: Paper;
  /** Verified items only. */
  extraction: PaperExtraction;
}

export interface Catalog {
  evidence: EvidenceItem[];
  studies: StudySummary[];
  metrics: MetricGroup[];
}

/** "Oikonomou EK" + 2023 -> "Oikonomou 2023". */
export function studyLabel(paper: Paper): string {
  const surname = paper.authors[0]?.split(/\s+/)[0];
  const parts = [surname, paper.year].filter((p) => p !== undefined && p !== "");
  return parts.length ? parts.join(" ") : paper.id;
}

// Names for the same quantity. Kept deliberately small: AUC and C-statistic
// are equivalent only for binary outcomes, so they are not merged.
const METRIC_SYNONYMS: Record<string, string> = {
  auc: "AUC",
  auroc: "AUC",
  "roc auc": "AUC",
  "auc roc": "AUC",
  "area under the curve": "AUC",
  "area under the roc curve": "AUC",
  "area under the receiver operating characteristic curve": "AUC",
  "c statistic": "C-statistic",
  cstatistic: "C-statistic",
  "c index": "C-index",
  "concordance index": "C-index",
};

function metricKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** First number in a reported value: 0.86 from "0.86 (95% CI 0.84-0.88)". */
export function pointEstimate(value: string): number | undefined {
  const match = /-?\d+(?:\.\d+)?/.exec(value);
  return match ? Number(match[0]) : undefined;
}

/**
 * Builds the evidence catalog and comparison tables. Entirely deterministic:
 * the model never touches these, so ids, numbers and groupings can be trusted.
 */
export function buildCatalog(papers: readonly ExtractedPaper[]): Catalog {
  const evidence: EvidenceItem[] = [];
  const studies: StudySummary[] = [];
  const groups = new Map<string, MetricGroup>();

  const add = (paperId: string, field: EvidenceItem["field"], value: string, quote: string): string => {
    const id = `E${evidence.length + 1}`;
    evidence.push({ id, paperId, field, value, quote });
    return id;
  };

  for (const { paper, extraction: x } of papers) {
    if (x.objective) add(paper.id, "objective", x.objective.value, x.objective.quote);
    if (x.studyDesign) add(paper.id, "studyDesign", x.studyDesign.category.replaceAll("_", " "), x.studyDesign.quote);
    if (x.population) add(paper.id, "population", x.population.value, x.population.quote);
    if (x.sampleSize) add(paper.id, "sampleSize", String(x.sampleSize.value), x.sampleSize.quote);
    if (x.dataset) add(paper.id, "dataset", x.dataset.value, x.dataset.quote);
    for (const m of x.methods) add(paper.id, "methods", m.value, m.quote);

    const metrics: StudySummary["metrics"] = [];
    for (const f of x.findings) {
      const id = add(paper.id, "findings", f.value, f.quote);
      for (const metric of f.metrics) {
        metrics.push({ name: metric.name, value: metric.value, evidenceId: id });

        const key = metricKey(metric.name);
        const canonical = METRIC_SYNONYMS[key] ?? key;
        const group = groups.get(canonical) ?? { metric: METRIC_SYNONYMS[key] ?? metric.name.trim(), entries: [] };
        const point = pointEstimate(metric.value);
        group.entries.push({ paperId: paper.id, value: metric.value, ...(point !== undefined && { point }), evidenceId: id });
        groups.set(canonical, group);
      }
    }
    for (const l of x.limitations) add(paper.id, "limitations", l.value, l.quote);

    studies.push({
      paperId: paper.id,
      label: studyLabel(paper),
      title: paper.title,
      ...(paper.year !== undefined && { year: paper.year }),
      ...(x.studyDesign && { design: x.studyDesign.category }),
      ...(x.sampleSize && { sampleSize: x.sampleSize.value }),
      ...(x.dataset && { dataset: x.dataset.value }),
      methods: x.methods.map((m) => m.value),
      metrics,
    });
  }

  const metrics = [...groups.values()]
    .map((g) => ({
      ...g,
      entries: [...g.entries].sort((a, b) => (b.point ?? -Infinity) - (a.point ?? -Infinity)),
    }))
    .sort((a, b) => new Set(b.entries.map((e) => e.paperId)).size - new Set(a.entries.map((e) => e.paperId)).size || a.metric.localeCompare(b.metric));

  return { evidence, studies, metrics };
}
