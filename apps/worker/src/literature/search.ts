import type {
  LiteratureSearchRequest,
  LiteratureSearchResult,
  LiteratureSource,
  Paper,
  Relevance,
  SearchQueries,
  SourceSearchOutcome,
} from "@synthora/schemas";
import { UpstreamError } from "../lib/http.js";
import { dedupeWithIndex } from "./dedupe.js";
import { rankPapers } from "./rank.js";
import type { LiteratureClient } from "./types.js";

interface Retrieved {
  paper: Paper;
  source: LiteratureSource;
  /** 1-based position in that source's results. */
  rank: number;
}

/**
 * Queries the requested sources in parallel, merges duplicates, and ranks
 * the result.
 *
 * A failing source does not fail the search; its outcome is reported so the
 * caller (and eventually the user) can see that coverage was partial.
 */
export async function searchLiterature(
  request: LiteratureSearchRequest,
  clients: readonly LiteratureClient[],
  /** Per-source queries and ranking text from a search plan. Without one, every source gets `request.query`. */
  queries?: SearchQueries,
): Promise<LiteratureSearchResult> {
  const selected = clients.filter((c) => request.sources.includes(c.source));
  const settled = await Promise.allSettled(selected.map((c) => c.search(queries?.[c.source] ?? request.query, request.limitPerSource)));

  const outcomes: SourceSearchOutcome[] = [];
  const perSource: Retrieved[][] = [];

  settled.forEach((result, i) => {
    const source = selected[i]!.source;
    if (result.status === "fulfilled") {
      outcomes.push({ source, status: "ok", totalHits: result.value.totalHits, returned: result.value.papers.length });
      perSource.push(result.value.papers.map((paper, position) => ({ paper, source, rank: position + 1 })));
    } else {
      outcomes.push({ source, status: "error", message: safeMessage(result.reason) });
    }
  });

  // Interleaving decides which source's record is "first seen" (and so wins
  // ties) when merging; it alternates fairly rather than favouring one source.
  const retrieved = interleave(perSource);
  const { papers, groupOf } = dedupeWithIndex(retrieved.map((r) => r.paper));

  const sourceRanks: Array<Relevance["sourceRanks"]> = papers.map(() => ({}));
  retrieved.forEach(({ source, rank }, i) => {
    const ranks = sourceRanks[groupOf[i]!]!;
    // A source occasionally returns the same paper twice; keep its best rank.
    ranks[source] = Math.min(ranks[source] ?? rank, rank);
  });

  return {
    query: request.query,
    papers: rankPapers(
      queries?.ranking ?? request.query,
      papers.map((paper, i) => ({ paper, sourceRanks: sourceRanks[i]! })),
    ),
    outcomes,
    totalRetrieved: retrieved.length,
  };
}

/** Round-robin merge of several lists, preserving each list's internal order. */
export function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const item = list[i];
      if (item !== undefined) out.push(item);
    }
  }
  return out;
}

/** Only messages we constructed ourselves are passed through; anything else could leak internals. */
function safeMessage(reason: unknown): string {
  return reason instanceof UpstreamError ? reason.message : "Unexpected error while searching this source";
}
