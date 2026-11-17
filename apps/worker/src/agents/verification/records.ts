import type { Paper, PaperCheck } from "@synthora/schemas";
import type { CrossrefWork } from "../../literature/crossref.js";

export interface CrossrefLookup {
  work(doi: string): Promise<CrossrefWork | undefined>;
}

/** Titles at or above this token similarity are treated as the same work. */
export const TITLE_MATCH_THRESHOLD = 0.75;

const RETRACTED_TYPES = new Set(["retracted publication"]);
const PREPRINT_TYPES = new Set(["preprint"]);

function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 0),
  );
}

/**
 * Overlap coefficient of title words. Tolerates punctuation, case, subtitles
 * dropped by one source, and markup differences, while still separating
 * genuinely different papers.
 */
export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

function hasType(paper: Paper, types: Set<string>): boolean {
  return paper.publicationTypes.some((t) => types.has(t.toLowerCase()));
}

export async function checkPaper(paper: Paper, crossref: CrossrefLookup): Promise<PaperCheck> {
  const base = {
    paperId: paper.id,
    retracted: hasType(paper, RETRACTED_TYPES),
    preprint: hasType(paper, PREPRINT_TYPES),
  };
  if (!paper.doi) return { ...base, crossref: "no_doi" };

  let work: CrossrefWork | undefined;
  try {
    work = await crossref.work(paper.doi);
  } catch {
    return { ...base, crossref: "error" };
  }
  if (!work) return { ...base, crossref: "not_in_crossref" };

  const similarity = work.title ? Math.round(titleSimilarity(paper.title, work.title) * 100) / 100 : undefined;
  return {
    ...base,
    // A record with no registered title cannot contradict ours, so it counts as a match.
    crossref: similarity === undefined || similarity >= TITLE_MATCH_THRESHOLD ? "match" : "mismatch",
    ...(work.title && { crossrefTitle: work.title }),
    ...(work.year !== undefined && { crossrefYear: work.year }),
    ...(similarity !== undefined && { titleSimilarity: similarity }),
  };
}

/** Checks papers with bounded concurrency to stay polite to Crossref. Results keep input order. */
export async function checkPapers(papers: readonly Paper[], crossref: CrossrefLookup, concurrency = 4): Promise<PaperCheck[]> {
  const results: PaperCheck[] = new Array(papers.length);
  let next = 0;
  const worker = async () => {
    while (next < papers.length) {
      const index = next++;
      results[index] = await checkPaper(papers[index]!, crossref);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, papers.length)) }, worker));
  return results;
}
