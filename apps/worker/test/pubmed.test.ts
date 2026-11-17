import { describe, expect, it } from "vitest";
import { Paper } from "@synthora/schemas";
import { parsePubMedXml, PubMedClient } from "../src/literature/pubmed.js";
import { fixture, noSleep, scriptedFetch } from "./helpers.js";

describe("parsePubMedXml (recorded efetch response)", () => {
  const papers = parsePubMedXml(fixture("pubmed-efetch.xml"));

  it("parses every article into a schema-valid paper", () => {
    expect(papers.map((p) => p.pmid)).toEqual(["37749579", "38008807", "40241176"]);
    for (const p of papers) expect(Paper.safeParse(p).success).toBe(true);
  });

  it("extracts identifiers from the article's own ArticleIdList, not its references", () => {
    const [first, second, third] = papers;
    expect(first).toMatchObject({
      id: "pmid:37749579",
      pmcid: "PMC10521578",
      doi: "10.1186/s12933-023-01985-3",
    });
    expect(second?.doi).toBe("10.1007/s11883-023-01174-3");
    expect(second?.pmcid).toBeUndefined(); // Not in PMC, even though cited references are.
    expect(third?.pmcid).toBe("PMC12004813");
  });

  it("extracts bibliographic fields", () => {
    expect(papers[0]).toMatchObject({
      title: "Machine learning in precision diabetes care and cardiovascular risk prediction.",
      journal: "Cardiovascular diabetology",
      year: 2023,
      sources: ["pubmed"],
    });
    expect(papers[0]?.authors.slice(0, 2)).toEqual(["Oikonomou EK", "Khera R"]);
    expect(papers[0]?.publicationTypes).toContain("Review");
  });

  it("keeps structured abstract labels", () => {
    expect(papers[1]?.abstract).toMatch(/^PURPOSE OF REVIEW: /);
    expect(papers[1]?.abstract).toContain("\n\nRECENT FINDINGS: ");
    expect(papers[2]?.abstract).toMatch(/^BACKGROUND: [\s\S]*\n\nCONCLUSIONS: /);
  });
});

describe("parsePubMedXml (edge cases)", () => {
  const xml = `<?xml version="1.0"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <PMID Version="1">111</PMID>
      <Article>
        <Journal><JournalIssue><PubDate><MedlineDate>2019 Nov-Dec</MedlineDate></PubDate></JournalIssue><Title>J Test</Title></Journal>
        <ArticleTitle>Effect of <i>H. pylori</i> on CO<sub>2</sub> &amp; more</ArticleTitle>
        <ELocationID EIdType="doi" ValidYN="Y">10.5555/ELOC</ELocationID>
        <Abstract><AbstractText>Only one section, with p &lt; 0.05.</AbstractText></Abstract>
        <AuthorList>
          <Author><CollectiveName>CARDIO Study Group</CollectiveName></Author>
          <Author><LastName>Solo</LastName></Author>
        </AuthorList>
        <PublicationTypeList><PublicationType UI="D016428">Journal Article</PublicationType></PublicationTypeList>
      </Article>
    </MedlineCitation>
    <PubmedData><ArticleIdList><ArticleId IdType="pubmed">111</ArticleId></ArticleIdList></PubmedData>
  </PubmedArticle>
  <PubmedArticle>
    <MedlineCitation><PMID Version="1">222</PMID><Article><ArticleTitle></ArticleTitle></Article></MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;

  const papers = parsePubMedXml(xml);

  it("handles a single article, inline markup, MedlineDate, ELocationID DOI and collective authors", () => {
    expect(papers).toHaveLength(1);
    expect(papers[0]).toEqual({
      id: "pmid:111",
      pmid: "111",
      doi: "10.5555/eloc",
      title: "Effect of H. pylori on CO2 & more",
      abstract: "Only one section, with p < 0.05.",
      authors: ["CARDIO Study Group", "Solo"],
      journal: "J Test",
      year: 2019,
      publicationTypes: ["Journal Article"],
      sources: ["pubmed"],
    });
  });

  it("returns nothing for an empty set", () => {
    expect(parsePubMedXml("<PubmedArticleSet></PubmedArticleSet>")).toEqual([]);
  });
});

describe("PubMedClient.search", () => {
  it("runs esearch then efetch, sending tool/email/api_key and preserving relevance order", async () => {
    const esearch = JSON.parse(fixture("pubmed-esearch.json")) as { esearchresult: { idlist: string[] } };
    esearch.esearchresult.idlist.reverse(); // efetch returns a different order than esearch
    const { fetch, calls } = scriptedFetch([
      Response.json(esearch),
      new Response(fixture("pubmed-efetch.xml")),
    ]);
    const client = new PubMedClient(
      { tool: "synthora", email: "ops@example.org", apiKey: "k" },
      { fetch, sleep: noSleep },
    );

    const result = await client.search("ml cvd", 3);

    expect(result.totalHits).toBe(4934);
    expect(result.papers.map((p) => p.pmid)).toEqual(["40241176", "38008807", "37749579"]);

    const search = calls[0]!.url;
    expect(search.pathname).toBe("/entrez/eutils/esearch.fcgi");
    expect(Object.fromEntries(search.searchParams)).toMatchObject({
      db: "pubmed",
      term: "ml cvd",
      retmax: "3",
      tool: "synthora",
      email: "ops@example.org",
      api_key: "k",
    });

    expect(calls[1]!.init?.method).toBe("POST");
    const body = new URLSearchParams(String(calls[1]!.init?.body));
    expect(body.get("id")).toBe("40241176,38008807,37749579");
    expect(body.get("api_key")).toBe("k");
  });

  it("skips efetch when there are no hits", async () => {
    const { fetch, calls } = scriptedFetch([Response.json({ esearchresult: { count: "0", idlist: [] } })]);
    const result = await new PubMedClient({ tool: "synthora" }, { fetch }).search("nothing", 5);
    expect(result).toEqual({ totalHits: 0, papers: [] });
    expect(calls).toHaveLength(1);
  });

  it("rejects an unexpected esearch payload", async () => {
    const { fetch } = scriptedFetch([Response.json({ error: "API rate limit exceeded" })]);
    await expect(new PubMedClient({ tool: "synthora" }, { fetch }).search("q", 5)).rejects.toThrow(
      "unexpected response shape",
    );
  });
});
