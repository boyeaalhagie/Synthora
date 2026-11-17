import type { Paper } from "@synthora/schemas";
import { withPaperId } from "./types.js";

type IdKind = "pmid" | "doi" | "pmcid";
const ID_KINDS: readonly IdKind[] = ["pmid", "doi", "pmcid"];

/**
 * Merges records that refer to the same publication.
 *
 * Two records are the same paper when they share any identifier (PMID, DOI,
 * or PMCID) and none of their identifiers conflict. The conflict check is
 * deliberately conservative: two records with the same DOI but different
 * PMIDs are kept apart, because merging distinct papers would corrupt
 * citations, while a missed duplicate is only cosmetic.
 *
 * Title-based matching is intentionally not done here.
 *
 * Output order follows each paper's first appearance in the input.
 */
export function dedupePapers(papers: readonly Paper[]): Paper[] {
  return dedupeWithIndex(papers).papers;
}

export interface DedupeResult {
  papers: Paper[];
  /** `groupOf[i]` is the position in `papers` that input `i` was merged into. */
  groupOf: number[];
}

/** {@link dedupePapers}, also reporting where each input record ended up. */
export function dedupeWithIndex(papers: readonly Paper[]): DedupeResult {
  const groups: Paper[] = [];
  const groupOf: number[] = [];
  const index = new Map<string, number>(); // "pmid:123" -> group position

  for (const paper of papers) {
    const candidates = new Set<number>();
    for (const kind of ID_KINDS) {
      const value = paper[kind];
      const hit = value === undefined ? undefined : index.get(`${kind}:${value}`);
      if (hit !== undefined) candidates.add(hit);
    }

    const target = [...candidates].sort((a, b) => a - b).find((g) => compatible(groups[g]!, paper));

    if (target === undefined) {
      groups.push(paper);
      groupOf.push(groups.length - 1);
      register(index, paper, groups.length - 1);
    } else {
      groups[target] = mergePair(groups[target]!, paper);
      groupOf.push(target);
      register(index, groups[target], target);
    }
  }

  return { papers: groups, groupOf };
}

function register(index: Map<string, number>, paper: Paper, position: number): void {
  for (const kind of ID_KINDS) {
    const value = paper[kind];
    const key = `${kind}:${value}`;
    // First registration wins, so an identifier always points at one group.
    if (value !== undefined && !index.has(key)) index.set(key, position);
  }
}

function compatible(a: Paper, b: Paper): boolean {
  return ID_KINDS.every((kind) => a[kind] === undefined || b[kind] === undefined || a[kind] === b[kind]);
}

function longer<T extends { length: number }>(a: T | undefined, b: T | undefined): T | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return b.length > a.length ? b : a;
}

function union<T>(a: readonly T[], b: readonly T[]): T[] {
  return [...new Set([...a, ...b])];
}

/** Combines two records of the same paper. `a` (seen first) wins ties. */
export function mergePair(a: Paper, b: Paper): Paper {
  const abstract = longer(a.abstract, b.abstract);
  const journal = a.journal ?? b.journal;
  const year = a.year ?? b.year;
  const isOpenAccess = a.isOpenAccess ?? b.isOpenAccess;
  const license = a.license ?? b.license;
  const pmid = a.pmid ?? b.pmid;
  const pmcid = a.pmcid ?? b.pmcid;
  const doi = a.doi ?? b.doi;

  const merged = withPaperId({
    ...(pmid !== undefined && { pmid }),
    ...(pmcid !== undefined && { pmcid }),
    ...(doi !== undefined && { doi }),
    title: a.title,
    ...(abstract !== undefined && { abstract }),
    authors: longer(a.authors, b.authors) ?? [],
    ...(journal !== undefined && { journal }),
    ...(year !== undefined && { year }),
    publicationTypes: union(a.publicationTypes, b.publicationTypes),
    ...(isOpenAccess !== undefined && { isOpenAccess }),
    ...(license !== undefined && { license }),
    sources: union(a.sources, b.sources),
  });
  // Both inputs had an identifier, so the merge always has one.
  return merged!;
}
