import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import type { Paper } from "@synthora/schemas";
import { fetchWithRetry, UpstreamError, type FetchWithRetryDeps } from "../lib/http.js";
import { normalizeDoi, normalizePmcid, normalizePmid } from "../lib/identifiers.js";
import { nonEmpty, parseYear, stripMarkup } from "../lib/text.js";
import { compact, withPaperId, type LiteratureClient, type SourceSearchResponse } from "./types.js";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export interface PubMedConfig {
  /** Sent as `tool` — NCBI asks every E-utilities client to identify itself. */
  tool: string;
  /** Contact address for NCBI. Operator-configured; never a user's address. */
  email?: string | undefined;
  apiKey?: string | undefined;
}

const ESearchResponse = z.object({
  esearchresult: z.object({
    count: z.string().regex(/^\d+$/),
    idlist: z.array(z.string()),
  }),
});

/**
 * PubMed via NCBI E-utilities: `esearch` for relevance-ranked PMIDs, then
 * `efetch` for full records (abstracts are only available as XML).
 */
export class PubMedClient implements LiteratureClient {
  readonly source = "pubmed" as const;

  constructor(
    private readonly config: PubMedConfig,
    private readonly deps: FetchWithRetryDeps,
  ) {}

  async search(query: string, limit: number): Promise<SourceSearchResponse> {
    const searchUrl = this.url("esearch.fcgi", {
      db: "pubmed",
      term: query,
      retmode: "json",
      retmax: String(limit),
      sort: "relevance",
    });
    const response = await fetchWithRetry(searchUrl, { headers: { accept: "application/json" } }, this.deps);
    const parsed = ESearchResponse.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new UpstreamError("PubMed esearch returned an unexpected response shape");

    const totalHits = Number(parsed.data.esearchresult.count);
    const pmids = parsed.data.esearchresult.idlist.map((id) => normalizePmid(id)).filter((id) => id !== undefined);
    if (pmids.length === 0) return { totalHits, papers: [] };

    // POST keeps long ID lists out of the URL length limit.
    const fetchUrl = this.url("efetch.fcgi", {});
    const body = new URLSearchParams({ db: "pubmed", id: pmids.join(","), retmode: "xml" });
    const xml = await (
      await fetchWithRetry(
        fetchUrl,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: withAuthParams(body, this.config).toString(),
        },
        this.deps,
      )
    ).text();

    // efetch does not guarantee order; restore esearch's relevance order.
    const byPmid = new Map(parsePubMedXml(xml).map((p) => [p.pmid, p]));
    const papers = pmids.map((id) => byPmid.get(id)).filter((p) => p !== undefined);
    return { totalHits, papers };
  }

  private url(endpoint: string, params: Record<string, string>): URL {
    const url = new URL(`${EUTILS}/${endpoint}`);
    if (Object.keys(params).length > 0) {
      url.search = withAuthParams(new URLSearchParams(params), this.config).toString();
    }
    return url;
  }
}

function withAuthParams(params: URLSearchParams, config: PubMedConfig): URLSearchParams {
  params.set("tool", config.tool);
  if (config.email) params.set("email", config.email);
  if (config.apiKey) params.set("api_key", config.apiKey);
  return params;
}

// --- XML parsing ------------------------------------------------------------

const ARTICLE = "PubmedArticleSet.PubmedArticle";
const ARRAY_PATHS = new Set([
  ARTICLE,
  `${ARTICLE}.MedlineCitation.Article.Abstract.AbstractText`,
  `${ARTICLE}.MedlineCitation.Article.AuthorList.Author`,
  `${ARTICLE}.MedlineCitation.Article.PublicationTypeList.PublicationType`,
  `${ARTICLE}.MedlineCitation.Article.ELocationID`,
  `${ARTICLE}.PubmedData.ArticleIdList.ArticleId`,
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  // Keep identifiers like "0123" and years as strings.
  parseTagValue: false,
  parseAttributeValue: false,
  // Titles and abstracts can contain inline markup (<i>, <sup>); keep it raw and strip it ourselves.
  stopNodes: ["*.ArticleTitle", "*.AbstractText"],
  jPath: true,
  isArray: (_name, jpath) => typeof jpath === "string" && ARRAY_PATHS.has(jpath),
});

type XmlNode = Record<string, unknown>;

function asNode(value: unknown): XmlNode | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as XmlNode) : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

/** Text content of an element that may be parsed as a string or as `{ "#text": … }` when it has attributes. */
function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  const text = asNode(value)?.["#text"];
  return text === undefined ? undefined : String(text);
}

function attr(value: unknown, name: string): string | undefined {
  const v = asNode(value)?.[`@_${name}`];
  return typeof v === "string" ? v : undefined;
}

function path(node: unknown, ...keys: string[]): unknown {
  let current = node;
  for (const key of keys) current = asNode(current)?.[key];
  return current;
}

/** Parses an efetch `PubmedArticleSet`. Book records and records without a PMID or title are skipped. */
export function parsePubMedXml(xml: string): Array<Paper & { pmid: string }> {
  const doc = parser.parse(xml) as unknown;
  const papers: Array<Paper & { pmid: string }> = [];

  for (const article of asArray(path(doc, "PubmedArticleSet", "PubmedArticle"))) {
    const paper = articleToPaper(article);
    if (paper?.pmid) papers.push(paper as Paper & { pmid: string });
  }
  return papers;
}

function articleToPaper(entry: unknown): Paper | undefined {
  const citation = path(entry, "MedlineCitation");
  const article = path(citation, "Article");

  const pmid = normalizePmid(textOf(path(citation, "PMID")));
  const title = stripMarkup(textOf(path(article, "ArticleTitle")) ?? "");
  if (!pmid || !title) return undefined;

  // Use only the paper's own top-level ArticleIdList — the ReferenceList nested
  // under PubmedData has ArticleIdLists for *cited* papers.
  const ids = asArray(path(entry, "PubmedData", "ArticleIdList", "ArticleId"));
  const idOfType = (type: string) => textOf(ids.find((id) => attr(id, "IdType") === type));

  const eLocationDoi = asArray(path(article, "ELocationID")).find((e) => attr(e, "EIdType") === "doi");

  const pubDate = path(article, "Journal", "JournalIssue", "PubDate");

  return withPaperId(
    compact({
      pmid,
      pmcid: normalizePmcid(idOfType("pmc")),
      doi: normalizeDoi(idOfType("doi")) ?? normalizeDoi(textOf(eLocationDoi)),
      title,
      abstract: abstractOf(article),
      authors: asArray(path(article, "AuthorList", "Author"))
        .map(authorName)
        .filter((n) => n !== undefined),
      journal: nonEmpty(textOf(path(article, "Journal", "Title"))),
      year: parseYear(textOf(path(pubDate, "Year")) ?? textOf(path(pubDate, "MedlineDate"))),
      publicationTypes: asArray(path(article, "PublicationTypeList", "PublicationType"))
        .map((t) => nonEmpty(textOf(t)))
        .filter((t) => t !== undefined),
      sources: ["pubmed" as const],
    }),
  );
}

/** Joins structured abstracts ("BACKGROUND: …") into paragraphs. */
function abstractOf(article: unknown): string | undefined {
  const sections = asArray(path(article, "Abstract", "AbstractText"))
    .map((section) => {
      const text = stripMarkup(textOf(section) ?? "");
      if (!text) return undefined;
      const label = nonEmpty(attr(section, "Label"));
      return label ? `${label}: ${text}` : text;
    })
    .filter((s) => s !== undefined);
  return sections.length ? sections.join("\n\n") : undefined;
}

/** Formats as "LastName Initials" to match Europe PMC's `fullName`. */
function authorName(author: unknown): string | undefined {
  const collective = nonEmpty(textOf(path(author, "CollectiveName")));
  if (collective) return stripMarkup(collective);
  const last = nonEmpty(textOf(path(author, "LastName")));
  if (!last) return undefined;
  const initials = nonEmpty(textOf(path(author, "Initials")));
  return initials ? `${last} ${initials}` : last;
}
