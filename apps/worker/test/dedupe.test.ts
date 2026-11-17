import { describe, expect, it } from "vitest";
import { dedupePapers } from "../src/literature/dedupe.js";
import { paper } from "./helpers.js";

describe("dedupePapers", () => {
  it("merges records sharing a PMID and combines their fields", () => {
    const fromPubMed = paper({
      id: "pmid:1",
      pmid: "1",
      title: "Title from PubMed",
      abstract: "BACKGROUND: long structured abstract",
      authors: ["A B", "C D"],
      publicationTypes: ["Journal Article", "Review"],
      sources: ["pubmed"],
    });
    const fromEpmc = paper({
      id: "pmid:1",
      pmid: "1",
      doi: "10.1000/x",
      title: "Title from Europe PMC",
      abstract: "short",
      authors: ["A B"],
      publicationTypes: ["Journal Article"],
      isOpenAccess: true,
      license: "cc by",
      sources: ["europepmc"],
    });

    expect(dedupePapers([fromPubMed, fromEpmc])).toEqual([
      {
        id: "pmid:1",
        pmid: "1",
        doi: "10.1000/x",
        title: "Title from PubMed",
        abstract: "BACKGROUND: long structured abstract",
        authors: ["A B", "C D"],
        publicationTypes: ["Journal Article", "Review"],
        isOpenAccess: true,
        license: "cc by",
        sources: ["pubmed", "europepmc"],
      },
    ]);
  });

  it("merges via DOI and upgrades the id to the PMID once one is known", () => {
    const doiOnly = paper({ id: "doi:10.1000/x", doi: "10.1000/x", sources: ["europepmc"] });
    const withPmid = paper({ id: "pmid:9", pmid: "9", doi: "10.1000/x", sources: ["pubmed"] });
    const result = dedupePapers([doiOnly, withPmid]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "pmid:9", pmid: "9", doi: "10.1000/x" });
  });

  it("chains identifiers: a later PMCID-only record joins a group found by DOI", () => {
    const result = dedupePapers([
      paper({ id: "doi:10.1000/x", doi: "10.1000/x" }),
      paper({ id: "pmid:9", pmid: "9", doi: "10.1000/x", pmcid: "PMC5" }),
      paper({ id: "pmcid:PMC5", pmcid: "PMC5" }),
    ]);
    expect(result).toHaveLength(1);
  });

  it("keeps records apart when identifiers conflict, even if one is shared", () => {
    const result = dedupePapers([
      paper({ id: "pmid:1", pmid: "1", doi: "10.1000/shared" }),
      paper({ id: "pmid:2", pmid: "2", doi: "10.1000/shared" }),
    ]);
    expect(result.map((p) => p.id)).toEqual(["pmid:1", "pmid:2"]);
  });

  it("does not merge on title", () => {
    const result = dedupePapers([
      paper({ id: "pmid:1", pmid: "1", title: "Same" }),
      paper({ id: "pmid:2", pmid: "2", title: "Same" }),
    ]);
    expect(result).toHaveLength(2);
  });

  it("preserves first-appearance order", () => {
    const result = dedupePapers([
      paper({ id: "pmid:3", pmid: "3" }),
      paper({ id: "pmid:1", pmid: "1" }),
      paper({ id: "pmid:3", pmid: "3" }),
      paper({ id: "pmid:2", pmid: "2" }),
    ]);
    expect(result.map((p) => p.id)).toEqual(["pmid:3", "pmid:1", "pmid:2"]);
  });
});
