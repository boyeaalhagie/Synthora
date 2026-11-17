import { z } from "zod";

/** Literature sources Synthora can retrieve records from. */
export const LiteratureSource = z.enum(["pubmed", "europepmc"]);
export type LiteratureSource = z.infer<typeof LiteratureSource>;

/** PubMed identifier: a positive integer, kept as a string. */
export const Pmid = z.string().regex(/^[1-9]\d*$/, "PMID must be a positive integer");

/** PubMed Central identifier, normalised to the `PMC123456` form. */
export const Pmcid = z.string().regex(/^PMC\d+$/, "PMCID must look like PMC123456");

/**
 * DOI, normalised to lowercase with no resolver prefix (`10.1000/xyz`).
 * DOIs are case-insensitive by spec, so lowercasing is safe for comparison.
 */
export const Doi = z.string().regex(/^10\.\d{4,9}\/\S+$/, "DOI must look like 10.xxxx/suffix");

/**
 * A publication record normalised across sources.
 *
 * Identifiers are only ever copied from source APIs — never generated or
 * inferred — so every paper Synthora cites can be traced to a real record.
 */
export const Paper = z.object({
  /** Stable key used for deduplication: `pmid:…`, `doi:…`, or `pmcid:…`. */
  id: z.string().min(1),
  pmid: Pmid.optional(),
  pmcid: Pmcid.optional(),
  doi: Doi.optional(),
  title: z.string().min(1),
  /** Plain-text abstract with markup stripped. */
  abstract: z.string().optional(),
  authors: z.array(z.string()),
  journal: z.string().optional(),
  year: z.number().int().min(1800).max(2100).optional(),
  publicationTypes: z.array(z.string()),
  /** Whether the full text is open access according to the source. Not a licence grant. */
  isOpenAccess: z.boolean().optional(),
  license: z.string().optional(),
  /** Every source this record was seen in, after merging duplicates. */
  sources: z.array(LiteratureSource).min(1),
});
export type Paper = z.infer<typeof Paper>;
