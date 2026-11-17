import type { LiteratureSource, Paper } from "@synthora/schemas";

export interface SourceSearchResponse {
  /** Total hits the source reports for the query. */
  totalHits: number;
  /** Normalised papers, in the source's relevance order. */
  papers: Paper[];
}

export interface LiteratureClient {
  readonly source: LiteratureSource;
  search(query: string, limit: number): Promise<SourceSearchResponse>;
}

type PaperFields = Omit<Paper, "id">;

/**
 * Assigns a stable id from the strongest identifier available. Returns
 * `undefined` for records with no PMID, DOI, or PMCID: without one, the paper
 * cannot be verified or cited, so it is excluded.
 */
export function withPaperId(fields: PaperFields): Paper | undefined {
  const id = fields.pmid
    ? `pmid:${fields.pmid}`
    : fields.doi
      ? `doi:${fields.doi}`
      : fields.pmcid
        ? `pmcid:${fields.pmcid}`
        : undefined;
  return id ? { id, ...fields } : undefined;
}

/** Builds a PaperFields object, omitting keys whose value is undefined (required by exactOptionalPropertyTypes). */
export function compact<T extends Record<string, unknown>>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}
