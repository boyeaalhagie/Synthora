import { describe, expect, it } from "vitest";
import { Paper } from "@synthora/schemas";
import { abstractToText, EuropePmcClient } from "../src/literature/europepmc.js";
import { fixture, scriptedFetch } from "./helpers.js";

describe("EuropePmcClient.search (recorded response)", () => {
  async function run() {
    const { fetch, calls } = scriptedFetch([new Response(fixture("europepmc-search.json"))]);
    const result = await new EuropePmcClient({ fetch }).search("ml cvd", 3);
    return { result, calls };
  }

  it("requests core JSON results with the page size", async () => {
    const { calls } = await run();
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({
      query: "ml cvd",
      format: "json",
      resultType: "core",
      pageSize: "3",
    });
  });

  it("normalises every record into a schema-valid paper", async () => {
    const { result } = await run();
    expect(result.totalHits).toBe(43957);
    expect(result.papers).toHaveLength(3);
    for (const p of result.papers) expect(Paper.safeParse(p).success).toBe(true);
  });

  it("maps MEDLINE records", async () => {
    const { result } = await run();
    expect(result.papers[0]).toMatchObject({
      id: "pmid:42954301",
      pmid: "42954301",
      doi: "10.1093/rheumatology/keag607",
      year: 2026,
      isOpenAccess: false,
      license: "cc by",
      authors: ["Papazoglou N", "Sfikakis PP", "Tektonidou MG"],
      publicationTypes: ["Journal Article"],
      sources: ["europepmc"],
    });
    expect(result.papers[0]?.abstract).toMatch(/^Objectives: To evaluate/);
  });

  it("keeps preprints, keyed by DOI and marked as such", async () => {
    const { result } = await run();
    const preprint = result.papers[2];
    expect(preprint).toMatchObject({ id: "doi:10.21203/rs.3.rs-11183490/v1", publicationTypes: ["Preprint"] });
    expect(preprint?.pmid).toBeUndefined();
    expect(preprint?.abstract).toMatch(/^Background: Atherosclerotic/);
  });

  it("drops individual malformed or unidentifiable records instead of failing", async () => {
    const body = {
      hitCount: 3,
      resultList: {
        result: [
          { title: "No identifiers at all" },
          { pmid: "1", title: 42 },
          { pmid: "2", title: "Fine" },
        ],
      },
    };
    const { fetch } = scriptedFetch([Response.json(body)]);
    const result = await new EuropePmcClient({ fetch }).search("q", 3);
    expect(result.papers.map((p) => p.id)).toEqual(["pmid:2"]);
  });
});

describe("abstractToText", () => {
  it("renders HTML and JATS section headings as labels", () => {
    expect(abstractToText("<h4>Methods</h4>We did <i>x</i>.<h4>Results</h4>It worked.")).toBe(
      "Methods: We did x. Results: It worked.",
    );
    expect(abstractToText("<title>Abstract</title><p><bold>Background:</bold> Text.</p>")).toBe(
      "Background: Text.",
    );
  });
});
