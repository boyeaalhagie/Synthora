import { describe, expect, it } from "vitest";
import { SearchPlanResult } from "@synthora/schemas";
import { planSearch, SYSTEM_PROMPT } from "../src/agents/planner/agent.js";
import { buildQueries, cleanTerm, europePmcQuery, fallbackQueries, pubmedQuery } from "../src/agents/planner/queries.js";
import { ProviderError, type GenerateRequest, type GenerateResult, type ProviderAdapter } from "../src/providers/types.js";

const plan = {
  concepts: [
    { name: "machine learning", terms: ["machine learning", "random forest", "XGBoost"] },
    { name: "cardiovascular disease", terms: ["cardiovascular disease", "coronary heart disease"] },
  ],
  yearFrom: 2019,
  yearTo: null,
};

describe("cleanTerm", () => {
  it.each([
    ['"heart failure"[MeSH]', "heart failure"],
    ["cancer* OR tumour", "cancer tumour"],
    ["TITLE:(stroke)", "TITLE stroke"],
    ["type-2 diabetes", "type-2 diabetes"],
    ["Alzheimer's disease", "Alzheimer's disease"],
  ])("cleanTerm(%j) = %j", (raw, expected) => {
    expect(cleanTerm(raw)).toBe(expected);
  });
});

describe("query building", () => {
  it("builds a PubMed query of ORed title/abstract phrases per concept, ANDed, with a date range", () => {
    expect(pubmedQuery(plan)).toBe(
      '("machine learning"[tiab] OR "random forest"[tiab] OR "XGBoost"[tiab]) AND ("cardiovascular disease"[tiab] OR "coronary heart disease"[tiab]) AND ("2019"[dp] : "3000"[dp])',
    );
  });

  it("builds the equivalent Europe PMC query", () => {
    expect(europePmcQuery(plan)).toBe(
      '("machine learning" OR "random forest" OR "XGBoost") AND ("cardiovascular disease" OR "coronary heart disease") AND PUB_YEAR:[2019 TO 3000]',
    );
  });

  it("never lets a term alter the query structure", () => {
    const hostile = { concepts: [{ name: "x", terms: ['stroke") OR ("everything', "NOT cancer"] }], yearFrom: null, yearTo: null };
    expect(pubmedQuery(hostile)).toBe('("stroke everything"[tiab] OR "cancer"[tiab])');
  });

  it("drops concepts whose terms clean to nothing, and deduplicates terms", () => {
    const q = buildQueries("q", { concepts: [{ name: "x", terms: ["AND", "()"] }, { name: "y", terms: ["sepsis", "sepsis"] }], yearFrom: null, yearTo: null });
    expect(q.pubmed).toBe('("sepsis"[tiab])');
  });

  it("ranks with the question plus every planned term", () => {
    expect(buildQueries("Which ML works?", plan).ranking).toBe(
      "Which ML works? machine learning random forest XGBoost cardiovascular disease coronary heart disease",
    );
  });
});

function adapter(outputs: Array<Partial<GenerateResult> | Error>) {
  const calls: GenerateRequest[] = [];
  const a: ProviderAdapter = {
    provider: "openai",
    async listModels() {
      return [];
    },
    async generate(request) {
      calls.push(request);
      const next = outputs.shift();
      if (next instanceof Error) throw next;
      return { text: "", stopReason: "end", model: "gpt-test", usage: { inputTokens: 100, outputTokens: 40 }, ...next };
    },
  };
  return { adapter: a, calls };
}

describe("planSearch", () => {
  const now = new Date("2026-11-16T00:00:00Z");

  it("returns the plan and the queries built from it", async () => {
    const { adapter: a, calls } = adapter([{ text: JSON.stringify(plan) }]);
    const result = await planSearch("Which ML models predict CVD?", a, { model: "gpt-test", now });
    expect(SearchPlanResult.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ status: "planned", yearFrom: 2019, model: "gpt-test", promptVersion: "planner-v1", attempts: 1 });
    expect(result.queries.pubmed).toContain('"XGBoost"[tiab]');
    expect(calls[0]).toMatchObject({ system: SYSTEM_PROMPT });
    expect(calls[0]?.prompt).toContain("The current year is 2026.");
  });

  it("rejects an inverted year range and repairs it", async () => {
    const { adapter: a, calls } = adapter([{ text: JSON.stringify({ ...plan, yearFrom: 2024, yearTo: 2020 }) }, { text: JSON.stringify(plan) }]);
    expect((await planSearch("q", a, { model: "m", now })).status).toBe("planned");
    expect(calls[1]?.prompt).toContain("yearFrom must not be after yearTo");
  });

  it("falls back to the question as written when planning fails, keeping the tokens spent", async () => {
    const { adapter: a } = adapter([new ProviderError("rate_limited", 429)]);
    const result = await planSearch("Which ML models predict CVD?", a, { model: "m", now });
    expect(result).toEqual({
      status: "fallback",
      reason: "The provider is rate-limiting this key or its quota is exhausted.",
      queries: fallbackQueries("Which ML models predict CVD?"),
      providerErrorKind: "rate_limited",
      attempts: 1,
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });
});
