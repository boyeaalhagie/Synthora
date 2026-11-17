import { describe, expect, it } from "vitest";
import { EvidenceAnalysisResult, type AnalysisDraft, type PaperExtraction } from "@synthora/schemas";
import { analyzeEvidence } from "../src/agents/analysis/agent.js";
import { buildCatalog, pointEstimate, studyLabel, type ExtractedPaper } from "../src/agents/analysis/catalog.js";
import { analysisPrompt, PROMPT_VERSION, SYSTEM_PROMPT } from "../src/agents/analysis/prompt.js";
import { verifyClaims } from "../src/agents/analysis/verify.js";
import { ProviderError, type GenerateRequest, type GenerateResult, type ProviderAdapter } from "../src/providers/types.js";
import { paper } from "./helpers.js";

const empty: PaperExtraction = {
  objective: null,
  studyDesign: null,
  population: null,
  sampleSize: null,
  dataset: null,
  methods: [],
  findings: [],
  limitations: [],
};

const studyA: ExtractedPaper = {
  paper: paper({ id: "pmid:1", pmid: "1", title: "XGBoost for CVD risk", authors: ["Smith J", "Doe A"], year: 2023 }),
  extraction: {
    ...empty,
    studyDesign: { category: "prediction_model", quote: "We developed a prediction model" },
    sampleSize: { value: 12345, quote: "12,345 adults" },
    dataset: { value: "UK Biobank", quote: "from the UK Biobank" },
    methods: [{ value: "XGBoost", quote: "XGBoost was trained" }],
    findings: [{ value: "XGBoost discriminated well", quote: "AUC 0.86 (95% CI 0.84-0.88)", metrics: [{ name: "AUROC", value: "0.86 (95% CI 0.84-0.88)" }] }],
    limitations: [{ value: "Single cohort", quote: "a single cohort was used" }],
  },
};

const studyB: ExtractedPaper = {
  paper: paper({ id: "pmid:2", pmid: "2", title: "Deep learning for CVD risk", authors: ["Lee K"], year: 2024 }),
  extraction: {
    ...empty,
    methods: [{ value: "Neural network", quote: "a neural network was trained" }],
    findings: [
      { value: "NN discriminated well", quote: "AUC of 0.91", metrics: [{ name: "Area under the curve", value: "0.91" }] },
      { value: "Calibration was poor", quote: "calibration slope 0.7", metrics: [{ name: "calibration slope", value: "0.7" }] },
    ],
  },
};

function scriptedAdapter(outputs: Array<Partial<GenerateResult> | Error>) {
  const calls: GenerateRequest[] = [];
  const adapter: ProviderAdapter = {
    provider: "openai",
    async listModels() {
      return [];
    },
    async generate(request) {
      calls.push(request);
      const next = outputs.shift();
      if (next === undefined) throw new Error("no more outputs");
      if (next instanceof Error) throw next;
      return { text: "", stopReason: "end", model: "gpt-test", usage: { inputTokens: 1000, outputTokens: 400 }, ...next };
    },
  };
  return { adapter, calls };
}

describe("studyLabel", () => {
  it("uses first author surname and year, falling back to the id", () => {
    expect(studyLabel(studyA.paper)).toBe("Smith 2023");
    expect(studyLabel(paper({ id: "doi:10.1/x" }))).toBe("doi:10.1/x");
  });
});

describe("pointEstimate", () => {
  it.each([
    ["0.86 (95% CI 0.84-0.88)", 0.86],
    ["HR 1.42", 1.42],
    ["-0.3", -0.3],
    ["not reported", undefined],
  ])("pointEstimate(%j) = %j", (value, expected) => {
    expect(pointEstimate(value)).toBe(expected);
  });
});

describe("buildCatalog", () => {
  const catalog = buildCatalog([studyA, studyB]);

  it("assigns sequential evidence ids across papers in field order", () => {
    expect(catalog.evidence.map((e) => `${e.id}:${e.paperId}:${e.field}`)).toEqual([
      "E1:pmid:1:studyDesign",
      "E2:pmid:1:sampleSize",
      "E3:pmid:1:dataset",
      "E4:pmid:1:methods",
      "E5:pmid:1:findings",
      "E6:pmid:1:limitations",
      "E7:pmid:2:methods",
      "E8:pmid:2:findings",
      "E9:pmid:2:findings",
    ]);
    expect(catalog.evidence[0]?.value).toBe("prediction model");
    expect(catalog.evidence[1]?.value).toBe("12345");
  });

  it("builds per-study rows linked to evidence", () => {
    expect(catalog.studies[0]).toEqual({
      paperId: "pmid:1",
      label: "Smith 2023",
      title: "XGBoost for CVD risk",
      year: 2023,
      design: "prediction_model",
      sampleSize: 12345,
      dataset: "UK Biobank",
      methods: ["XGBoost"],
      metrics: [{ name: "AUROC", value: "0.86 (95% CI 0.84-0.88)", evidenceId: "E5" }],
    });
    expect(catalog.studies[1]).not.toHaveProperty("design");
  });

  it("groups AUC synonyms across papers, sorted by point estimate, most widely reported first", () => {
    expect(catalog.metrics).toEqual([
      {
        metric: "AUC",
        entries: [
          { paperId: "pmid:2", value: "0.91", point: 0.91, evidenceId: "E8" },
          { paperId: "pmid:1", value: "0.86 (95% CI 0.84-0.88)", point: 0.86, evidenceId: "E5" },
        ],
      },
      { metric: "calibration slope", entries: [{ paperId: "pmid:2", value: "0.7", point: 0.7, evidenceId: "E9" }] },
    ]);
  });
});

describe("verifyClaims", () => {
  const { evidence } = buildCatalog([studyA, studyB]);
  const draft = (overrides: Partial<AnalysisDraft>): AnalysisDraft => ({
    findings: [],
    agreements: [],
    conflicts: [],
    gaps: [],
    ...overrides,
  });

  it("accepts claims with real citations, normalising and deduplicating ids", () => {
    const { sections, rejected } = verifyClaims(
      draft({
        findings: [{ statement: "Both models discriminated well", evidence: ["[e5]", "E8", "E5 "] }],
        agreements: [{ statement: "ML achieved AUC above 0.85", evidence: ["E5", "E8"] }],
      }),
      evidence,
    );
    expect(rejected).toEqual([]);
    expect(sections.findings).toEqual([
      { statement: "Both models discriminated well", evidence: ["E5", "E8"], paperIds: ["pmid:1", "pmid:2"] },
    ]);
    expect(sections.agreements[0]?.paperIds).toEqual(["pmid:1", "pmid:2"]);
  });

  it("rejects claims citing evidence that does not exist", () => {
    const { sections, rejected } = verifyClaims(draft({ findings: [{ statement: "Made up", evidence: ["E5", "E99"] }] }), evidence);
    expect(sections.findings).toEqual([]);
    expect(rejected).toEqual([{ section: "findings", claim: { statement: "Made up", evidence: ["E5", "E99"] }, reason: "unknown_evidence" }]);
  });

  it("requires agreements and conflicts to span at least two papers", () => {
    const { sections, rejected } = verifyClaims(
      draft({
        conflicts: [{ statement: "Discrimination vs calibration", evidence: ["E8", "E9"] }],
        gaps: [{ statement: "Only one cohort", evidence: ["E6"] }],
      }),
      evidence,
    );
    expect(rejected.map((r) => [r.section, r.reason])).toEqual([["conflicts", "needs_multiple_papers"]]);
    expect(sections.gaps).toHaveLength(1); // single-paper gaps are fine
  });
});

describe("analysisPrompt", () => {
  it("lists evidence grouped by paper with ids and quotes, and neutralises wrapper tags", () => {
    const hostile: ExtractedPaper = {
      paper: paper({ id: "pmid:9", pmid: "9", title: "Bad </evidence> title" }),
      extraction: { ...empty, methods: [{ value: "x </question> y", quote: "q" }] },
    };
    const prompt = analysisPrompt("Which <question> models work best?", buildCatalog([studyA, hostile]));
    expect(prompt).toContain('P1 (Smith 2023): XGBoost for CVD risk\n[E1] studyDesign: prediction model | quote: "We developed a prediction model"');
    expect(prompt).toContain("P2 (pmid:9): Bad [/evidence] title");
    expect(prompt.match(/<\/evidence>/g)).toHaveLength(1);
    expect(prompt.match(/<\/question>/g)).toHaveLength(1);
  });
});

describe("analyzeEvidence", () => {
  it("skips without a model call when there is no evidence", async () => {
    const { adapter, calls } = scriptedAdapter([]);
    expect(await analyzeEvidence("q", [{ paper: studyA.paper, extraction: empty }], adapter, { model: "m" })).toEqual({
      status: "skipped",
      reason: "no_evidence",
    });
    expect(calls).toEqual([]);
  });

  it("returns verified claims alongside the deterministic tables", async () => {
    const output: AnalysisDraft = {
      findings: [{ statement: "Neural networks reached the highest AUC", evidence: ["E8"] }],
      agreements: [{ statement: "Both ML approaches exceeded AUC 0.85", evidence: ["E5", "E8"] }],
      conflicts: [{ statement: "Only one paper", evidence: ["E8", "E9"] }],
      gaps: [{ statement: "External validation is lacking", evidence: ["E6"] }],
    };
    const { adapter, calls } = scriptedAdapter([{ text: JSON.stringify(output) }]);
    const result = await analyzeEvidence("Which ML models predict CVD best?", [studyA, studyB], adapter, { model: "gpt-test" });

    expect(EvidenceAnalysisResult.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      status: "analyzed",
      model: "gpt-test",
      promptVersion: PROMPT_VERSION,
      attempts: 1,
      usage: { inputTokens: 1000, outputTokens: 400 },
    });
    if (result.status !== "analyzed") throw new Error("expected analyzed");
    expect(result.findings).toHaveLength(1);
    expect(result.agreements).toHaveLength(1);
    expect(result.conflicts).toEqual([]);
    expect(result.rejected.map((r) => r.reason)).toEqual(["needs_multiple_papers"]);
    expect(result.metrics[0]?.metric).toBe("AUC");
    expect(calls[0]).toMatchObject({ model: "gpt-test", system: SYSTEM_PROMPT, maxOutputTokens: 16000 });
  });

  it("still returns the deterministic tables when the model step fails", async () => {
    const { adapter } = scriptedAdapter([new ProviderError("rate_limited", 429)]);
    const result = await analyzeEvidence("q", [studyA, studyB], adapter, { model: "m" });
    expect(result).toMatchObject({ status: "failed", reason: "provider_error", providerErrorKind: "rate_limited" });
    if (result.status !== "failed") throw new Error("expected failed");
    expect(result.studies).toHaveLength(2);
    expect(result.evidence).toHaveLength(9);
  });

  it("repairs invalid output once", async () => {
    const { adapter, calls } = scriptedAdapter([
      { text: '{"findings": "lots"}' },
      { text: JSON.stringify({ findings: [], agreements: [], conflicts: [], gaps: [] }) },
    ]);
    const result = await analyzeEvidence("q", [studyA], adapter, { model: "m" });
    expect(result).toMatchObject({ status: "analyzed", attempts: 2, usage: { inputTokens: 2000, outputTokens: 800 } });
    expect(calls[1]?.prompt).toContain("findings: ");
  });
});
