import { z } from "zod";
import type { Paper } from "@synthora/schemas";
import { fetchWithRetry, UpstreamError, type FetchWithRetryDeps } from "../lib/http.js";
import { normalizeDoi, normalizePmcid, normalizePmid } from "../lib/identifiers.js";
import { nonEmpty, parseYear, stripMarkup } from "../lib/text.js";
import { compact, withPaperId, type LiteratureClient, type SourceSearchResponse } from "./types.js";

const SEARCH_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

// Only the fields we use. Unknown fields are ignored; each record is validated
// individually so one malformed record cannot fail the whole search.
const RawAuthor = z.object({
  fullName: z.string().optional(),
  collectiveName: z.string().optional(),
});

const RawResult = z.object({
  pmid: z.string().optional(),
  pmcid: z.string().optional(),
  doi: z.string().optional(),
  title: z.string().optional(),
  authorString: z.string().optional(),
  authorList: z.object({ author: z.array(RawAuthor).optional() }).optional(),
  journalInfo: z
    .object({
      yearOfPublication: z.number().optional(),
      journal: z.object({ title: z.string().optional() }).optional(),
    })
    .optional(),
  pubYear: z.string().optional(),
  abstractText: z.string().optional(),
  isOpenAccess: z.enum(["Y", "N"]).optional(),
  license: z.string().optional(),
  pubTypeList: z.object({ pubType: z.array(z.string()).optional() }).optional(),
});
type RawResult = z.infer<typeof RawResult>;

const SearchResponse = z.object({
  hitCount: z.number().int().nonnegative(),
  resultList: z.object({ result: z.array(z.unknown()) }),
});

export class EuropePmcClient implements LiteratureClient {
  readonly source = "europepmc" as const;

  constructor(private readonly deps: FetchWithRetryDeps) {}

  async search(query: string, limit: number): Promise<SourceSearchResponse> {
    const url = new URL(SEARCH_URL);
    url.search = new URLSearchParams({
      query,
      format: "json",
      resultType: "core",
      pageSize: String(limit),
    }).toString();

    const response = await fetchWithRetry(url, { headers: { accept: "application/json" } }, this.deps);
    const parsed = SearchResponse.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new UpstreamError("Europe PMC returned an unexpected response shape");

    const papers: Paper[] = [];
    for (const raw of parsed.data.resultList.result) {
      const record = RawResult.safeParse(raw);
      const paper = record.success ? toPaper(record.data) : undefined;
      if (paper) papers.push(paper);
    }
    return { totalHits: parsed.data.hitCount, papers };
  }
}

export function toPaper(raw: RawResult): Paper | undefined {
  const title = raw.title ? stripMarkup(raw.title) : "";
  if (!title) return undefined;

  const abstract = raw.abstractText ? abstractToText(raw.abstractText) : "";

  return withPaperId(
    compact({
      pmid: normalizePmid(raw.pmid),
      pmcid: normalizePmcid(raw.pmcid),
      doi: normalizeDoi(raw.doi),
      title,
      abstract: abstract || undefined,
      authors: authorsOf(raw),
      journal: nonEmpty(raw.journalInfo?.journal?.title),
      year: parseYear(raw.journalInfo?.yearOfPublication ?? raw.pubYear),
      publicationTypes: raw.pubTypeList?.pubType ?? [],
      isOpenAccess: raw.isOpenAccess === undefined ? undefined : raw.isOpenAccess === "Y",
      license: nonEmpty(raw.license),
      sources: ["europepmc" as const],
    }),
  );
}

/**
 * Europe PMC abstracts are HTML (`<h4>Objectives</h4>…`) for MEDLINE records
 * and JATS (`<title>Abstract</title><p>…`) for preprints. Section headings are
 * rendered as "Label: text" to match PubMed's structured abstracts.
 */
export function abstractToText(html: string): string {
  return stripMarkup(
    html
      .replace(/<title>\s*abstract\s*<\/title>/gi, " ")
      .replace(/<(h[1-6]|title)\b[^>]*>([^<]*)<\/\1>/gi, (_m, _tag, label: string) => ` ${label.trim()}: `),
  );
}

function authorsOf(raw: RawResult): string[] {
  const list = raw.authorList?.author;
  if (list?.length) {
    return list.map((a) => nonEmpty(a.fullName) ?? nonEmpty(a.collectiveName)).filter((n) => n !== undefined);
  }
  // Fallback: "Smith J, Doe A, Roe B."
  return (raw.authorString ?? "")
    .replace(/\.$/, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
