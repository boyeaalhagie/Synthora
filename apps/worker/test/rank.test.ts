import { describe, expect, it } from "vitest";
import { RankedPaper } from "@synthora/schemas";
import { bm25Scores, queryTerms, rankPapers, tokenize } from "../src/literature/rank.js";
import { paper } from "./helpers.js";

describe("tokenize", () => {
  it("lowercases, splits on punctuation, drops stopwords and folds simple plurals", () => {
    expect(tokenize("Machine-Learning Models for the Prediction of Studies")).toEqual([
      "machine",
      "learning",
      "model",
      "prediction",
      "study",
    ]);
  });

  it("keeps words ending in -ss, -us, -is intact", () => {
    expect(tokenize("stenosis mellitus stress")).toEqual(["stenosis", "mellitus", "stress"]);
  });

  it("strips diacritics", () => {
    expect(tokenize("Sjögren")).toEqual(["sjogren"]);
  });
});

describe("queryTerms", () => {
  it("ignores field tags and boolean operators, and deduplicates", () => {
    expect(queryTerms('"heart failure"[MeSH Terms] AND heart[tiab] NOT pediatric')).toEqual([
      "heart",
      "failure",
      "pediatric",
    ]);
  });
});

describe("bm25Scores", () => {
  const docs = [
    paper({ id: "a", title: "Machine learning for cardiovascular risk prediction" }),
    paper({ id: "b", title: "Machine learning for fall risk prediction" }),
    paper({ id: "c", title: "Gardening outcomes", abstract: "Unrelated." }),
  ];

  it("ranks the document matching the discriminating term highest", () => {
    const [a, b, c] = bm25Scores("machine learning cardiovascular risk", docs);
    expect(a).toBeGreaterThan(b!);
    expect(b).toBeGreaterThan(0);
    expect(c).toBe(0);
  });

  it("weights terms that appear in every document less than rarer ones", () => {
    // "machine" is in a and b; "cardiovascular" only in a.
    const [onlyCommon] = bm25Scores("machine", docs);
    const [onlyRare] = bm25Scores("cardiovascular", docs);
    expect(onlyRare).toBeGreaterThan(onlyCommon!);
  });

  it("gives title matches more weight than abstract matches", () => {
    const [inTitle, inAbstract] = bm25Scores("statin", [
      paper({ id: "t", title: "Statin therapy", abstract: "Outcomes were measured." }),
      paper({ id: "a", title: "Lipid therapy", abstract: "Statin outcomes were measured." }),
    ]);
    expect(inTitle).toBeGreaterThan(inAbstract!);
  });

  it("returns zeros for an empty query", () => {
    expect(bm25Scores("the and of", docs)).toEqual([0, 0, 0]);
  });
});

describe("rankPapers", () => {
  it("rewards papers returned by several sources", () => {
    const ranked = rankPapers("unmatched query", [
      { paper: paper({ id: "single" }), sourceRanks: { pubmed: 1 } },
      { paper: paper({ id: "both" }), sourceRanks: { pubmed: 2, europepmc: 2 } },
    ]);
    expect(ranked.map((p) => p.id)).toEqual(["both", "single"]);
  });

  it("lets lexical relevance lift an on-topic paper above an off-topic one ranked higher by its source", () => {
    const ranked = rankPapers("cardiovascular risk", [
      { paper: paper({ id: "off-topic", title: "Fall risk in older adults" }), sourceRanks: { europepmc: 1 } },
      { paper: paper({ id: "on-topic", title: "Cardiovascular risk scores" }), sourceRanks: { europepmc: 2 } },
    ]);
    expect(ranked.map((p) => p.id)).toEqual(["on-topic", "off-topic"]);
  });

  it("attaches a schema-valid relevance breakdown with RRF scores", () => {
    const [top] = rankPapers("statin", [
      { paper: paper({ id: "p", title: "Statin therapy" }), sourceRanks: { pubmed: 1 } },
    ]);
    expect(RankedPaper.safeParse(top).success).toBe(true);
    expect(top?.relevance.sourceRanks).toEqual({ pubmed: 1 });
    // One source at rank 1 plus lexical rank 1: 2 / (60 + 1)
    expect(top?.relevance.score).toBeCloseTo(2 / 61, 6);
  });

  it("keeps input order for exact ties", () => {
    const ranked = rankPapers("nothing", [
      { paper: paper({ id: "first" }), sourceRanks: { pubmed: 1 } },
      { paper: paper({ id: "second" }), sourceRanks: { europepmc: 1 } },
    ]);
    expect(ranked.map((p) => p.id)).toEqual(["first", "second"]);
  });
});
