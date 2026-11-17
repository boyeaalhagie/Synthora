import { describe, expect, it } from "vitest";
import { rate, retrievalMetrics, sumRates } from "../eval/metrics.js";

describe("retrievalMetrics", () => {
  const judgments = { a: 2, b: 1, c: 0, d: 2, e: 1 } as const;

  it("computes precision, recall, reciprocal rank and unjudged counts", () => {
    const m = retrievalMetrics(["c", "a", "x", "b"], judgments, 4);
    expect(m.precisionAtK).toBe(2 / 4); // a and b
    expect(m.recallAtK).toBe(2 / 4); // of a, b, d, e
    expect(m.reciprocalRank).toBe(1 / 2);
    expect(m.unjudgedInTopK).toBe(1); // x
  });

  it("gives nDCG 1 for an ideal ranking and less for a worse one", () => {
    expect(retrievalMetrics(["a", "d", "b", "e"], judgments, 4).ndcgAtK).toBeCloseTo(1, 10);
    const worse = retrievalMetrics(["b", "e", "a", "d"], judgments, 4).ndcgAtK;
    expect(worse).toBeGreaterThan(0);
    expect(worse).toBeLessThan(1);
  });

  it("matches a hand-computed nDCG", () => {
    // DCG = (2^1-1)/log2(2) + (2^2-1)/log2(3) = 1 + 3/1.58496 ; ideal for {2,1} = 3 + 1/1.58496
    const m = retrievalMetrics(["b", "a"], { a: 2, b: 1 }, 2);
    expect(m.ndcgAtK).toBeCloseTo((1 + 3 / Math.log2(3)) / (3 + 1 / Math.log2(3)), 10);
  });

  it("scores zero, not NaN, when nothing is relevant or retrieved", () => {
    expect(retrievalMetrics([], judgments, 10)).toMatchObject({ precisionAtK: 0, recallAtK: 0, ndcgAtK: 0, reciprocalRank: 0 });
    expect(retrievalMetrics(["a"], {}, 10)).toMatchObject({ recallAtK: 0, ndcgAtK: 0, unjudgedInTopK: 1 });
  });

  it("divides precision by k even when fewer than k papers were retrieved", () => {
    expect(retrievalMetrics(["a"], judgments, 10).precisionAtK).toBe(0.1);
  });
});

describe("rates", () => {
  it("aggregates from counts rather than averaging ratios", () => {
    const total = sumRates([
      { count: 1, total: 2 },
      { count: 0, total: 98 },
    ]);
    expect(total).toEqual({ count: 1, total: 100 });
    expect(rate(total)).toBe(0.01);
    expect(rate({ count: 0, total: 0 })).toBe(0);
  });
});
