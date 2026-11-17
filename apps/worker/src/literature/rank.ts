import type { Paper, RankedPaper, Relevance } from "@synthora/schemas";

/**
 * Deterministic relevance ranking.
 *
 * 1. BM25 scores each paper's title + abstract against the query. Document
 *    statistics come from the retrieved set itself, so terms shared by every
 *    result ("machine learning") weigh less than discriminating ones
 *    ("cardiovascular").
 * 2. Reciprocal rank fusion (RRF) combines the BM25 ranking with each
 *    source's own ranking. A paper returned by several sources gains one
 *    contribution per source, rewarding cross-source agreement.
 *
 * RRF fuses ranks rather than raw scores, so sources with incomparable
 * scoring scales (or none) can be combined, and new signals (e.g. embedding
 * similarity) can be added as further ranked lists.
 */

export interface RankOptions {
  /** BM25 term-frequency saturation. */
  k1: number;
  /** BM25 length normalisation (0 = none, 1 = full). */
  b: number;
  /** Title tokens count this many times (a simple BM25F approximation). */
  titleWeight: number;
  /** RRF damping constant; 60 is the value from the original paper (Cormack et al., 2009). */
  rrfK: number;
}

export const DEFAULT_RANK_OPTIONS: RankOptions = { k1: 1.2, b: 0.75, titleWeight: 2, rrfK: 60 };

export interface RankInput {
  paper: Paper;
  sourceRanks: Relevance["sourceRanks"];
}

// Common English function words plus boolean search operators.
const STOPWORDS = new Set(
  (
    "a an and are as at be but by can do does for from has have how in into is it its of on or " +
    "not that the their there these this those to was were what when where which while who why " +
    "with within without vs versus than then they them we our us i"
  ).split(" "),
);

/** Very light suffix stripping so "models"/"model" and "studies"/"study" match. */
function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("s") && !/(?:ss|us|is)$/.test(token)) return token.slice(0, -1);
  return token;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

/** Query terms, ignoring search syntax such as PubMed field tags (`[tiab]`, `[MeSH Terms]`). */
export function queryTerms(query: string): string[] {
  return [...new Set(tokenize(query.replace(/\[[^\]]*\]/g, " ")))];
}

export function bm25Scores(query: string, papers: readonly Paper[], options: RankOptions = DEFAULT_RANK_OPTIONS): number[] {
  const terms = queryTerms(query);
  if (terms.length === 0 || papers.length === 0) return papers.map(() => 0);

  const docs = papers.map((p) => {
    const tokens = [...Array.from({ length: options.titleWeight }, () => tokenize(p.title)).flat(), ...tokenize(p.abstract ?? "")];
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { tf, length: tokens.length };
  });

  const avgLength = docs.reduce((sum, d) => sum + d.length, 0) / docs.length || 1;
  const n = docs.length;
  const idf = new Map(
    terms.map((term) => {
      const df = docs.filter((d) => d.tf.has(term)).length;
      // BM25+ style IDF: always positive, even for terms present in every document.
      return [term, Math.log(1 + (n - df + 0.5) / (df + 0.5))];
    }),
  );

  const { k1, b } = options;
  return docs.map(({ tf, length }) =>
    terms.reduce((score, term) => {
      const f = tf.get(term) ?? 0;
      if (f === 0) return score;
      return score + idf.get(term)! * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * length) / avgLength)));
    }, 0),
  );
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

export function rankPapers(
  query: string,
  inputs: readonly RankInput[],
  options: RankOptions = DEFAULT_RANK_OPTIONS,
): RankedPaper[] {
  const lexical = bm25Scores(
    query,
    inputs.map((i) => i.paper),
    options,
  );

  // Lexical rank among papers that match at least one query term; non-matching papers get no lexical credit.
  const lexicalRank = new Map<number, number>();
  inputs
    .map((_, i) => i)
    .filter((i) => lexical[i]! > 0)
    .sort((a, b) => lexical[b]! - lexical[a]! || a - b)
    .forEach((i, position) => lexicalRank.set(i, position + 1));

  const contribution = (rank: number | undefined) => (rank === undefined ? 0 : 1 / (options.rrfK + rank));

  return inputs
    .map((input, i) => {
      const ranks = [...Object.values(input.sourceRanks), lexicalRank.get(i)];
      const score = ranks.reduce<number>((sum, rank) => sum + contribution(rank), 0);
      return {
        order: i,
        paper: {
          ...input.paper,
          relevance: { score: round(score), lexicalScore: round(lexical[i]!), sourceRanks: input.sourceRanks },
        },
      };
    })
    .sort(
      (a, b) =>
        b.paper.relevance.score - a.paper.relevance.score ||
        b.paper.relevance.lexicalScore - a.paper.relevance.lexicalScore ||
        a.order - b.order,
    )
    .map((x) => x.paper);
}
