import type {
  EvidenceAnalysisResult,
  ExtractionResult,
  Paper,
  Reference,
  SearchPlanResult,
  SourceSearchOutcome,
  VerificationResult,
} from "@synthora/schemas";

const SOURCE_NAMES: Record<SourceSearchOutcome["source"], string> = { pubmed: "PubMed", europepmc: "Europe PMC" };
const fmt = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Vancouver-style citation from source metadata only. */
export function formatCitation(paper: Paper): string {
  const authors = paper.authors.length > 6 ? `${paper.authors.slice(0, 6).join(", ")}, et al` : paper.authors.join(", ");
  const title = /[.?!]$/.test(paper.title) ? paper.title : `${paper.title}.`;
  const preprint = paper.publicationTypes.some((t) => t.toLowerCase() === "preprint") ? " [Preprint]." : "";
  const parts = [
    authors ? `${authors}.` : undefined,
    `${title}${preprint}`,
    paper.journal ? `${paper.journal}.` : undefined,
    paper.year !== undefined ? `${paper.year}.` : undefined,
    paper.doi ? `doi:${paper.doi}.` : undefined,
    paper.pmid ? `PMID: ${paper.pmid}.` : undefined,
  ];
  return parts.filter(Boolean).join(" ");
}

export function buildReference(number: number, paper: Paper): Reference {
  return {
    number,
    paperId: paper.id,
    citation: formatCitation(paper),
    ...(paper.doi && { doi: paper.doi }),
    ...(paper.pmid && { pmid: paper.pmid }),
  };
}

export interface PipelineFacts {
  question: string;
  date: string;
  plan: SearchPlanResult;
  search: { outcomes: readonly SourceSearchOutcome[]; totalRetrieved: number };
  papers: readonly Paper[];
  extractions: readonly ExtractionResult[];
  analysis: EvidenceAnalysisResult;
  verification: VerificationResult;
  model: string;
  /** Papers whose evidence was excluded from the synthesis (retracted). */
  excludedPaperIds: ReadonlySet<string>;
}

/** The Methods section, composed from what the pipeline actually did. */
export function methodsParagraphs(f: PipelineFacts): string[][] {
  const searched = f.search.outcomes.map((o) =>
    o.status === "ok"
      ? `${SOURCE_NAMES[o.source]} returned the top ${fmt(o.returned)} of ${fmt(o.totalHits)} matching records`
      : `${SOURCE_NAMES[o.source]} could not be searched`,
  );
  const extracted = f.extractions.filter((e) => e.status === "extracted");
  const discarded = extracted.reduce((n, e) => n + (e.status === "extracted" ? e.rejected.length : 0), 0);
  const withDoi = f.verification.papers.filter((c) => c.crossref !== "no_doi");
  const doiMatched = withDoi.filter((c) => c.crossref === "match").length;
  const review = f.verification.claims;
  const unsupported = review.status === "assessed" ? review.assessments.filter((a) => a.verdict === "unsupported").length : 0;

  const strategy =
    f.plan.status === "planned"
      ? `The question was translated into a search strategy of ${f.plan.concepts.length} concept ${f.plan.concepts.length === 1 ? "group" : "groups"} (${f.plan.concepts.map((c) => c.name).join("; ")}), each matched by any of its synonyms in titles and abstracts${f.plan.yearFrom !== null || f.plan.yearTo !== null ? `, limited to ${f.plan.yearFrom ?? "any year"}–${f.plan.yearTo ?? "present"}` : ""}. The PubMed query was: ${f.plan.queries.pubmed}.`
      : `The question was searched as written (${f.plan.reason.replace(/\.$/, "")}).`;
  const search = [
    `This review addressed the question: “${f.question}”.`,
    strategy,
    `PubMed and Europe PMC were searched on ${f.date}; ${searched.join(", and ")}.`,
    `After duplicate records were merged, the ${fmt(f.search.totalRetrieved)} retrieved records were ranked by combining each source's ranking with lexical relevance (BM25) using reciprocal rank fusion, and the ${f.papers.length} highest-ranked records with abstracts were selected.`,
  ];
  const extraction = [
    `Study characteristics and findings were extracted from each title and abstract by ${f.model}.`,
    `Every extracted item had to quote the abstract verbatim; ${discarded} ${plural(discarded, "item was", "items were")} discarded because ${plural(discarded, "its quote", "their quotes")} could not be found in the source.`,
    `Verified data were obtained for ${extracted.length} of ${f.papers.length} selected papers.`,
  ];
  const checks = [
    `Claims comparing the papers had to cite the extracted evidence, and each was reviewed against the quotes it cites; ${unsupported} unsupported ${plural(unsupported, "claim was", "claims were")} removed.`,
    withDoi.length > 0
      ? `${doiMatched} of ${withDoi.length} DOIs were confirmed against their Crossref records.`
      : "No DOIs were available to check against Crossref.",
    "Every sentence in the written sections below cites the evidence it rests on, and any number it states must appear in that evidence.",
  ];
  return [search, extraction, checks];
}

/** The review's own limitations, stated from facts rather than generated. */
export function reviewLimitationParagraphs(f: PipelineFacts): string[][] {
  const failed = f.extractions.filter((e) => e.status === "failed").length;
  const preprints = f.verification.papers.filter((c) => c.preprint && !f.excludedPaperIds.has(c.paperId)).length;
  const excluded = f.excludedPaperIds.size;

  const sentences = [
    "This review is based on titles and abstracts only; full texts were not read, so methods and results may be reported incompletely.",
    `It covers ${f.papers.length} ${plural(f.papers.length, "paper", "papers")} selected by automated ranking and is not a systematic review; relevant studies may be missing.`,
  ];
  if (excluded > 0) sentences.push(`${excluded} retracted ${plural(excluded, "paper was", "papers were")} excluded from the synthesis.`);
  if (failed > 0) sentences.push(`${failed} selected ${plural(failed, "paper", "papers")} could not be extracted and ${plural(failed, "is", "are")} not represented.`);
  if (preprints > 0) sentences.push(`${preprints} of the included papers ${plural(preprints, "is a preprint", "are preprints")} that ${plural(preprints, "has", "have")} not been peer reviewed.`);
  sentences.push(
    `Extraction, analysis, claim review and writing were performed by ${f.model}; the same model reviewed its own claims, so the review is a consistency check rather than independent confirmation.`,
    "Synthora is a research-support tool. These findings are not clinical recommendations.",
  );
  return [sentences];
}
