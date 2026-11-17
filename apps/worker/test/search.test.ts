import { describe, expect, it } from "vitest";
import { LiteratureSearchResult, type LiteratureSource, type Paper } from "@synthora/schemas";
import { handleRequest } from "../src/index.js";
import { UpstreamError } from "../src/lib/http.js";
import { interleave, searchLiterature } from "../src/literature/search.js";
import type { LiteratureClient } from "../src/literature/types.js";
import { paper } from "./helpers.js";

function stubClient(source: LiteratureSource, outcome: Paper[] | Error): LiteratureClient & { queries: string[] } {
  const queries: string[] = [];
  return {
    source,
    queries,
    async search(query) {
      queries.push(query);
      if (outcome instanceof Error) throw outcome;
      return { totalHits: outcome.length * 10, papers: outcome };
    },
  };
}

const request = { query: "ml cvd", limitPerSource: 5, sources: ["pubmed", "europepmc"] as LiteratureSource[] };

describe("searchLiterature", () => {
  it("deduplicates, ranks cross-source agreement first, and reports per-source outcomes", async () => {
    const pubmed = stubClient("pubmed", [paper({ id: "pmid:1", pmid: "1" }), paper({ id: "pmid:2", pmid: "2" })]);
    const epmc = stubClient("europepmc", [
      paper({ id: "pmid:2", pmid: "2", sources: ["europepmc"] }),
      paper({ id: "pmid:3", pmid: "3", sources: ["europepmc"] }),
    ]);

    const result = await searchLiterature(request, [pubmed, epmc]);

    expect(LiteratureSearchResult.safeParse(result).success).toBe(true);
    expect(result.papers.map((p) => p.id)).toEqual(["pmid:2", "pmid:1", "pmid:3"]);
    expect(result.papers[0]?.sources).toEqual(["europepmc", "pubmed"]);
    expect(result.papers.map((p) => p.relevance.sourceRanks)).toEqual([
      { pubmed: 2, europepmc: 1 },
      { pubmed: 1 },
      { europepmc: 2 },
    ]);
    expect(result.totalRetrieved).toBe(4);
    expect(result.outcomes).toEqual([
      { source: "pubmed", status: "ok", totalHits: 20, returned: 2 },
      { source: "europepmc", status: "ok", totalHits: 20, returned: 2 },
    ]);
  });

  it("returns partial results when one source fails, exposing only safe messages", async () => {
    const result = await searchLiterature(request, [
      stubClient("pubmed", new UpstreamError("eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi responded 503", 503)),
      stubClient("europepmc", new Error("internal detail with api_key=SECRET")),
    ]);
    expect(result.papers).toEqual([]);
    expect(result.outcomes).toEqual([
      { source: "pubmed", status: "error", message: "eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi responded 503" },
      { source: "europepmc", status: "error", message: "Unexpected error while searching this source" },
    ]);
  });

  it("only queries the requested sources", async () => {
    const pubmed = stubClient("pubmed", []);
    const epmc = stubClient("europepmc", []);
    await searchLiterature({ ...request, sources: ["europepmc"] }, [pubmed, epmc]);
    expect(pubmed.queries).toEqual([]);
    expect(epmc.queries).toEqual(["ml cvd"]);
  });
});

describe("interleave", () => {
  it("round-robins lists of different lengths", () => {
    expect(interleave<number | string>([[1, 2, 3], ["a"], []])).toEqual([1, "a", 2, 3]);
  });
});

describe("POST /api/literature/search", () => {
  const clients = [stubClient("pubmed", [paper({ id: "pmid:1", pmid: "1" })]), stubClient("europepmc", [])];

  function post(body: string, contentType = "application/json") {
    return handleRequest(
      new Request("https://synthora.test/api/literature/search", {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      }),
      {},
      clients,
    );
  }

  it("applies defaults and returns results", async () => {
    const res = await post(JSON.stringify({ query: "ml cvd" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as LiteratureSearchResult;
    expect(body.papers.map((p) => p.id)).toEqual(["pmid:1"]);
    expect(body.outcomes.map((o) => o.source)).toEqual(["pubmed", "europepmc"]);
  });

  it("rejects invalid input with field-level issues", async () => {
    const res = await post(JSON.stringify({ query: "x", limitPerSource: 1000 }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: Array<{ path: string[] }> };
    expect(body.issues.map((i) => i.path[0]).sort()).toEqual(["limitPerSource", "query"]);
  });

  it("rejects malformed JSON, wrong content types and oversized bodies", async () => {
    expect((await post("{")).status).toBe(400);
    expect((await post("{}", "text/plain")).status).toBe(415);
    expect((await post(JSON.stringify({ query: "a".repeat(20_000) }))).status).toBe(413);
  });

  it("returns 502 when every source failed", async () => {
    const res = await handleRequest(
      new Request("https://synthora.test/api/literature/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "ml cvd", sources: ["pubmed"] }),
      }),
      {},
      [stubClient("pubmed", new UpstreamError("down"))],
    );
    expect(res.status).toBe(502);
  });

  it("handles method and route errors", async () => {
    const get = (path: string, method = "GET") =>
      handleRequest(new Request(`https://synthora.test${path}`, { method }), {}, clients);
    expect((await get("/api/health")).status).toBe(200);
    expect((await get("/api/literature/search")).status).toBe(405);
    expect((await get("/nope")).status).toBe(404);
  });
});
