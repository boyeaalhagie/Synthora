import { describe, expect, it } from "vitest";
import { ClaimSupportResult, PaperCheck, type EvidenceAnalysisResult } from "@synthora/schemas";
import { assessClaimSupport, claimsForReview } from "../src/agents/verification/agent.js";
import { checkPaper, checkPapers, titleSimilarity, type CrossrefLookup } from "../src/agents/verification/records.js";
import { CrossrefClient } from "../src/literature/crossref.js";
import type { GenerateRequest, GenerateResult, ProviderAdapter } from "../src/providers/types.js";
import { fixture, noSleep, paper, scriptedFetch } from "./helpers.js";

const retry = { retries: 1, baseDelayMs: 1, timeoutMs: 1000 };

describe("titleSimilarity", () => {
  it("ignores punctuation, case and markup differences", () => {
    expect(
      titleSimilarity(
        "Machine learning in precision diabetes care and cardiovascular risk prediction.",
        "Machine Learning in Precision Diabetes Care and Cardiovascular Risk Prediction",
      ),
    ).toBe(1);
  });

  it("tolerates a subtitle present in only one source", () => {
    expect(titleSimilarity("Deep learning for CVD risk", "Deep learning for CVD risk: a cohort study")).toBe(1);
  });

  it("separates different papers", () => {
    expect(titleSimilarity("Statins and liver injury in older adults", "Deep learning for retinal imaging")).toBeLessThan(0.3);
  });
});

describe("CrossrefClient", () => {
  it("parses the registered title and year from a recorded response", async () => {
    const { fetch, calls } = scriptedFetch([new Response(fixture("crossref-work.json"))]);
    const work = await new CrossrefClient({}, { fetch, sleep: noSleep, retry }).work("10.1186/s12933-023-01985-3");
    expect(work).toEqual({ title: "Machine learning in precision diabetes care and cardiovascular risk prediction", year: 2023 });
    expect(calls[0]!.url.pathname).toBe("/works/10.1186%2Fs12933-023-01985-3");
    expect(calls[0]!.headers.get("user-agent")).toBe("Synthora/0.1");
  });

  it("identifies itself with the operator's mailto when configured", async () => {
    const { fetch, calls } = scriptedFetch([new Response(fixture("crossref-work.json"))]);
    await new CrossrefClient({ mailto: "ops@example.org" }, { fetch, retry }).work("10.1/x");
    expect(calls[0]!.headers.get("user-agent")).toBe("Synthora/0.1 (mailto:ops@example.org)");
  });

  it("returns undefined for DOIs Crossref does not know, without retrying", async () => {
    const { fetch, calls } = scriptedFetch([new Response("Resource not found.", { status: 404 })]);
    expect(await new CrossrefClient({}, { fetch, retry }).work("10.5555/nope")).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("throws when Crossref keeps failing", async () => {
    const { fetch } = scriptedFetch([new Response("", { status: 503 }), new Response("", { status: 503 })]);
    await expect(new CrossrefClient({}, { fetch, sleep: noSleep, retry }).work("10.1/x")).rejects.toThrow("503");
  });
});

describe("checkPaper", () => {
  const lookup = (works: Record<string, { title?: string; year?: number } | Error | undefined>): CrossrefLookup => ({
    async work(doi) {
      const w = works[doi];
      if (w instanceof Error) throw w;
      return w;
    },
  });

  it("reports a match with the registered metadata", async () => {
    const check = await checkPaper(
      paper({ id: "pmid:1", pmid: "1", doi: "10.1/a", title: "Statins in older adults." }),
      lookup({ "10.1/a": { title: "Statins in Older Adults", year: 2021 } }),
    );
    expect(PaperCheck.safeParse(check).success).toBe(true);
    expect(check).toEqual({
      paperId: "pmid:1",
      crossref: "match",
      crossrefTitle: "Statins in Older Adults",
      crossrefYear: 2021,
      titleSimilarity: 1,
      retracted: false,
      preprint: false,
    });
  });

  it("flags a DOI that resolves to a different paper", async () => {
    const check = await checkPaper(
      paper({ id: "pmid:1", doi: "10.1/a", title: "Statins in older adults" }),
      lookup({ "10.1/a": { title: "Deep learning for retinal imaging" } }),
    );
    expect(check.crossref).toBe("mismatch");
  });

  it.each([
    ["no DOI", paper({ id: "pmid:1" }), "no_doi"],
    ["unknown to Crossref", paper({ id: "doi:10.1/b", doi: "10.1/b" }), "not_in_crossref"],
    ["Crossref unreachable", paper({ id: "doi:10.1/c", doi: "10.1/c" }), "error"],
  ] as const)("handles %s", async (_label, p, expected) => {
    expect((await checkPaper(p, lookup({ "10.1/c": new Error("down") }))).crossref).toBe(expected);
  });

  it("flags retracted papers and preprints from their publication types", async () => {
    const [retracted, preprint] = await checkPapers(
      [
        paper({ id: "pmid:1", publicationTypes: ["Journal Article", "Retracted Publication"] }),
        paper({ id: "doi:10.1/p", publicationTypes: ["Preprint"] }),
      ],
      lookup({}),
    );
    expect(retracted).toMatchObject({ retracted: true, preprint: false });
    expect(preprint).toMatchObject({ retracted: false, preprint: true });
  });
});

const analysis: Extract<EvidenceAnalysisResult, { status: "analyzed" }> = {
  status: "analyzed",
  evidence: [
    { id: "E1", paperId: "pmid:1", field: "findings", value: "AUC 0.86", quote: "XGBoost achieved an AUC of 0.86" },
    { id: "E2", paperId: "pmid:2", field: "findings", value: "AUC 0.81", quote: "the network reached an AUC of 0.81" },
    { id: "E3", paperId: "pmid:2", field: "limitations", value: "No external validation", quote: "not externally validated" },
  ],
  studies: [],
  metrics: [],
  findings: [
    { statement: "XGBoost reached AUC 0.86", evidence: ["E1"], paperIds: ["pmid:1"] },
    { statement: "XGBoost outperformed neural networks", evidence: ["E1", "E2"], paperIds: ["pmid:1", "pmid:2"] },
  ],
  agreements: [{ statement: "Both exceeded AUC 0.8", evidence: ["E1", "E2"], paperIds: ["pmid:1", "pmid:2"] }],
  conflicts: [],
  gaps: [{ statement: "External validation is lacking", evidence: ["E3"], paperIds: ["pmid:2"] }],
  rejected: [],
  model: "m",
  promptVersion: "analysis-v1",
  attempts: 1,
  usage: { inputTokens: 0, outputTokens: 0 },
};
const papers = [paper({ id: "pmid:1", authors: ["Smith J"], year: 2023 }), paper({ id: "pmid:2", authors: ["Lee K"], year: 2024 })];

function judge(outputs: Array<Partial<GenerateResult>>) {
  const calls: GenerateRequest[] = [];
  const adapter: ProviderAdapter = {
    provider: "gemini",
    async listModels() {
      return [];
    },
    async generate(request) {
      calls.push(request);
      const next = outputs.shift();
      if (!next) throw new Error("no more outputs");
      return { text: "", stopReason: "end", model: "gemini-test", usage: { inputTokens: 500, outputTokens: 200 }, ...next };
    },
  };
  return { adapter, calls };
}

describe("claimsForReview", () => {
  it("numbers claims across sections and attaches each cited quote with its study label", () => {
    const claims = claimsForReview(analysis, papers);
    expect(claims.map((c) => [c.id, c.sectionKey, c.index])).toEqual([
      ["C1", "findings", 0],
      ["C2", "findings", 1],
      ["C3", "agreements", 0],
      ["C4", "gaps", 0],
    ]);
    expect(claims[1]?.evidence).toEqual([
      { id: "E1", paperLabel: "Smith 2023", quote: "XGBoost achieved an AUC of 0.86" },
      { id: "E2", paperLabel: "Lee 2024", quote: "the network reached an AUC of 0.81" },
    ]);
  });
});

describe("assessClaimSupport", () => {
  it("maps verdicts back to claims, ignoring invented ids and marking skipped claims", async () => {
    const { adapter, calls } = judge([
      {
        text: JSON.stringify({
          assessments: [
            { claimId: "C1", verdict: "supported", explanation: "Quote states the AUC." },
            { claimId: "[c2]", verdict: "partially_supported", explanation: "AUCs are from different studies; no direct comparison." },
            { claimId: "C2", verdict: "supported", explanation: "duplicate, ignored" },
            { claimId: "C9", verdict: "unsupported", explanation: "invented id, ignored" },
            { claimId: "C4", verdict: "unsupported", explanation: "Quote is about a different study." },
          ],
        }),
      },
    ]);
    const result = await assessClaimSupport(analysis, papers, adapter, { model: "gemini-test" });

    expect(ClaimSupportResult.safeParse(result).success).toBe(true);
    expect(result.status === "assessed" && result.assessments.map((a) => [a.section, a.index, a.verdict])).toEqual([
      ["findings", 0, "supported"],
      ["findings", 1, "partially_supported"],
      ["agreements", 0, "not_assessed"],
      ["gaps", 0, "unsupported"],
    ]);
    expect(result).toMatchObject({ model: "gemini-test", promptVersion: "claim-support-v1", attempts: 1, usage: { inputTokens: 500, outputTokens: 200 } });
    expect(calls[0]?.prompt).toContain('C2 (findings): XGBoost outperformed neural networks');
    expect(calls[0]?.prompt).toContain('[E2] Lee 2024: "the network reached an AUC of 0.81"');
  });

  it("skips without a model call when there are no claims to assess", async () => {
    const { adapter, calls } = judge([]);
    expect(await assessClaimSupport({ status: "skipped", reason: "no_evidence" }, papers, adapter, { model: "m" })).toEqual({
      status: "skipped",
      reason: "no_claims",
    });
    const noClaims = { ...analysis, findings: [], agreements: [], gaps: [] };
    expect((await assessClaimSupport(noClaims, papers, adapter, { model: "m" })).status).toBe("skipped");
    expect(calls).toEqual([]);
  });

  it("reports failures such as refusals", async () => {
    const { adapter } = judge([{ stopReason: "refusal" }]);
    expect(await assessClaimSupport(analysis, papers, adapter, { model: "m" })).toMatchObject({ status: "failed", reason: "refusal" });
  });
});
