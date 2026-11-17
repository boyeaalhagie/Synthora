import { describe, expect, it } from "vitest";
import { normalizeDoi, normalizePmcid, normalizePmid } from "../src/lib/identifiers.js";
import { decodeEntities, parseYear, stripMarkup } from "../src/lib/text.js";

describe("stripMarkup", () => {
  it("removes inline tags without inserting spaces", () => {
    expect(stripMarkup("H<sub>2</sub>O and <i>E. coli</i>")).toBe("H2O and E. coli");
  });

  it("separates block-level elements", () => {
    expect(stripMarkup("<p>One.</p><p>Two.</p>")).toBe("One. Two.");
  });

  it("decodes entities after stripping, so escaped angle brackets survive as text", () => {
    expect(stripMarkup("p &lt; 0.05 &amp; n&#x3d;12")).toBe("p < 0.05 & n=12");
  });

  it("normalises Unicode spaces (thin, non-breaking) to plain spaces", () => {
    expect(stripMarkup("n&#x2009;=&#160;12")).toBe("n = 12");
  });
});

describe("decodeEntities", () => {
  it("leaves unknown and out-of-range entities untouched", () => {
    expect(decodeEntities("&bogus; &#x110000;")).toBe("&bogus; &#x110000;");
  });
});

describe("parseYear", () => {
  it.each([
    ["2023", 2023],
    [2019, 2019],
    ["2019 Nov-Dec", 2019],
    ["Winter 1998", 1998],
    ["n.d.", undefined],
    [undefined, undefined],
  ])("parseYear(%j) = %j", (input, expected) => {
    expect(parseYear(input)).toBe(expected);
  });
});

describe("identifier normalisation", () => {
  it("normalises DOIs to bare lowercase form", () => {
    expect(normalizeDoi("https://doi.org/10.1186/S12933-023-01985-3")).toBe("10.1186/s12933-023-01985-3");
    expect(normalizeDoi("doi: 10.1000/ABC")).toBe("10.1000/abc");
    expect(normalizeDoi("http://dx.doi.org/10.1000/x")).toBe("10.1000/x");
  });

  it("rejects malformed DOIs", () => {
    expect(normalizeDoi("not-a-doi")).toBeUndefined();
    expect(normalizeDoi("10.1/too-short-prefix")).toBeUndefined();
    expect(normalizeDoi("")).toBeUndefined();
  });

  it("validates PMIDs", () => {
    expect(normalizePmid(" 37749579 ")).toBe("37749579");
    expect(normalizePmid("0123")).toBeUndefined();
    expect(normalizePmid("12a")).toBeUndefined();
  });

  it("normalises PMCIDs", () => {
    expect(normalizePmcid("pmc10521578")).toBe("PMC10521578");
    expect(normalizePmcid("10521578")).toBe("PMC10521578");
    expect(normalizePmcid("PMCX")).toBeUndefined();
  });
});
