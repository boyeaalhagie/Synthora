import { describe, expect, it } from "vitest";
import { ResearchReport, type EvidenceAnalysisResult, type EvidenceItem, type ReportDraft, type VerificationResult } from "@synthora/schemas";
import { synthesizeReport, type SynthesisInput } from "../src/agents/synthesis/agent.js";
import { checkSentence, normalizeNumber, numbersIn } from "../src/agents/synthesis/check.js";
import { formatCitation } from "../src/agents/synthesis/facts.js";
import type { GenerateRequest, GenerateResult, ProviderAdapter } from "../src/providers/types.js";
import { paper } from "./helpers.js";

const E = (id: string, paperId: string, value: string, quote: string, field: EvidenceItem["field"] = "findings"): EvidenceItem => ({
  id,
  paperId,
  field,
  value,
  quote,
});

const evidence = [
  E("E1", "pmid:1", "12345", "a cohort of 12,345 adults", "sampleSize"),
  E("E2", "pmid:1", "XGBoost AUC 0.86", "XGBoost achieved an AUC of 0.86 (95% CI 0.84-0.88)"),
  E("E3", "pmid:2", "DNN AUC 0.81", "the network reached an AUC of 0.81"),
  E("E4", "pmid:2", "No external validation", "not validated outside the development health system", "limitations"),
  E("E5", "pmid:3", "Retracted result", "a remarkable AUC of 0.99"),
];

describe("number checks", () => {
  it.each([
    ["12,345", "12345"],
    ["0.80", "0.8"],
    ["0,86", "0.86"],
    ["1,000,000", "1000000"],
  ])("normalizeNumber(%j) = %j", (raw, expected) => {
    expect(normalizeNumber(raw)).toBe(expected);
  });

  it("extracts each number in a range separately", () => {
    expect(numbersIn("AUC 0.86 (95% CI 0.84-0.88)")).toEqual(["0.86", "95", "0.84", "0.88"]);
  });

  const ctx = { evidence: new Map(evidence.map((e) => [e.id, e])), paperYears: new Map([["pmid:1", 2023]]) };

  it("accepts sentences whose numbers all appear in their cited evidence", () => {
    expect(checkSentence({ text: "In 12345 adults, XGBoost reached an AUC of 0.86 (95% CI 0.84 to 0.88).", evidence: ["E1", "e2"] }, ctx)).toEqual({
      ok: true,
      evidence: ["E1", "E2"],
    });
  });

  it("rejects a statistic the cited evidence does not contain", () => {
    expect(checkSentence({ text: "XGBoost reached an AUC of 0.91.", evidence: ["E2"] }, ctx)).toEqual({
      ok: false,
      reason: "number_not_in_evidence",
      detail: "0.91",
    });
  });

  it("does not let a number from uncited evidence vouch for a sentence", () => {
    expect(checkSentence({ text: "The network reached an AUC of 0.81.", evidence: ["E2"] }, ctx)).toMatchObject({ ok: false, reason: "number_not_in_evidence" });
  });

  it("exempts small counts, cited papers' years, and echoed citation markup", () => {
    expect(checkSentence({ text: "One 2023 study (E2) [1] over 10 years found an AUC of 0.86.", evidence: ["E2"] }, ctx)).toMatchObject({ ok: true });
  });

  it("requires real citations", () => {
    expect(checkSentence({ text: "Machine learning is promising.", evidence: [] }, ctx)).toEqual({ ok: false, reason: "no_evidence" });
    expect(checkSentence({ text: "Some claim.", evidence: ["E2", "E42"] }, ctx)).toEqual({ ok: false, reason: "unknown_evidence" });
  });
});

describe("formatCitation", () => {
  it("formats a Vancouver-style reference from source metadata", () => {
    expect(
      formatCitation(
        paper({ id: "pmid:1", pmid: "1", doi: "10.1/a", title: "A study", authors: ["Smith J", "Doe A"], journal: "Heart", year: 2023 }),
      ),
    ).toBe("Smith J, Doe A. A study. Heart. 2023. doi:10.1/a. PMID: 1.");
  });

  it("abbreviates long author lists and marks preprints", () => {
    const authors = ["A A", "B B", "C C", "D D", "E E", "F F", "G G"];
    expect(formatCitation(paper({ id: "doi:10.1/p", doi: "10.1/p", title: "Is it?", authors, publicationTypes: ["Preprint"] }))).toBe(
      "A A, B B, C C, D D, E E, F F, et al. Is it? [Preprint]. doi:10.1/p.",
    );
  });
});

const papers = [
  paper({ id: "pmid:1", pmid: "1", doi: "10.1/a", title: "XGBoost for CVD", authors: ["Smith J"], journal: "Heart", year: 2023 }),
  paper({ id: "pmid:2", pmid: "2", title: "Deep learning for CVD", authors: ["Lee K"], year: 2024 }),
  paper({ id: "pmid:3", pmid: "3", title: "Retracted CVD study", authors: ["Roe B"], year: 2022, publicationTypes: ["Retracted Publication"] }),
];

const analysis: Extract<EvidenceAnalysisResult, { status: "analyzed" }> = {
  status: "analyzed",
  evidence,
  studies: [
    { paperId: "pmid:1", label: "Smith 2023", title: "XGBoost for CVD", year: 2023, design: "prediction_model", sampleSize: 12345, methods: ["XGBoost"], metrics: [{ name: "AUC", value: "0.86", evidenceId: "E2" }] },
    { paperId: "pmid:2", label: "Lee 2024", title: "Deep learning for CVD", year: 2024, methods: ["DNN"], metrics: [] },
    { paperId: "pmid:3", label: "Roe 2022", title: "Retracted CVD study", year: 2022, methods: [], metrics: [] },
  ],
  metrics: [],
  findings: [
    { statement: "XGBoost reached AUC 0.86", evidence: ["E2"], paperIds: ["pmid:1"] },
    { statement: "The retracted study reported AUC 0.99", evidence: ["E5"], paperIds: ["pmid:3"] },
    { statement: "XGBoost beat everything", evidence: ["E2", "E3"], paperIds: ["pmid:1", "pmid:2"] },
  ],
  agreements: [{ statement: "Both exceeded AUC 0.8", evidence: ["E2", "E3"], paperIds: ["pmid:1", "pmid:2"] }],
  conflicts: [],
  gaps: [{ statement: "External validation is lacking", evidence: ["E4"], paperIds: ["pmid:2"] }],
  rejected: [],
  model: "m",
  promptVersion: "analysis-v1",
  attempts: 1,
  usage: { inputTokens: 0, outputTokens: 0 },
};

const verification: VerificationResult = {
  papers: [
    { paperId: "pmid:1", crossref: "match", retracted: false, preprint: false },
    { paperId: "pmid:2", crossref: "no_doi", retracted: false, preprint: false },
    { paperId: "pmid:3", crossref: "no_doi", retracted: true, preprint: false },
  ],
  claims: {
    status: "assessed",
    model: "m",
    promptVersion: "claim-support-v1",
    attempts: 1,
    usage: { inputTokens: 0, outputTokens: 0 },
    assessments: [
      { section: "findings", index: 0, verdict: "supported", explanation: "ok" },
      { section: "findings", index: 1, verdict: "supported", explanation: "ok" },
      { section: "findings", index: 2, verdict: "unsupported", explanation: "No direct comparison." },
      { section: "agreements", index: 0, verdict: "partially_supported", explanation: "AUCs come from different outcomes." },
      { section: "gaps", index: 0, verdict: "supported", explanation: "ok" },
    ],
  },
};

const input: SynthesisInput = {
  question: "Which ML models predict CVD risk best?",
  search: {
    outcomes: [
      { source: "pubmed", status: "ok", totalHits: 4934, returned: 25 },
      { source: "europepmc", status: "error", message: "down" },
    ],
    totalRetrieved: 25,
  },
  papers,
  extractions: [
    { status: "extracted", paperId: "pmid:1", extraction: { objective: null, studyDesign: null, population: null, sampleSize: null, dataset: null, methods: [], findings: [], limitations: [] }, rejected: [{ field: "population", item: {}, reason: "quote_not_in_source" }], model: "m", promptVersion: "v", attempts: 1, usage: { inputTokens: 0, outputTokens: 0 } },
    { status: "extracted", paperId: "pmid:2", extraction: { objective: null, studyDesign: null, population: null, sampleSize: null, dataset: null, methods: [], findings: [], limitations: [] }, rejected: [], model: "m", promptVersion: "v", attempts: 1, usage: { inputTokens: 0, outputTokens: 0 } },
    { status: "failed", paperId: "pmid:3", reason: "refusal", message: "declined", attempts: 1, usage: { inputTokens: 0, outputTokens: 0 } },
  ],
  analysis,
  verification,
  now: new Date("2026-11-16T12:00:00Z"),
};

function writer(draft: ReportDraft | string) {
  const calls: GenerateRequest[] = [];
  const adapter: ProviderAdapter = {
    provider: "anthropic",
    async listModels() {
      return [];
    },
    async generate(request): Promise<GenerateResult> {
      calls.push(request);
      return {
        text: typeof draft === "string" ? draft : JSON.stringify(draft),
        stopReason: "end",
        model: "claude-opus-5-5",
        usage: { inputTokens: 4000, outputTokens: 1500 },
      };
    },
  };
  return { adapter, calls };
}

const draft: ReportDraft = {
  title: "Machine learning for cardiovascular risk prediction",
  summary: [
    [
      { text: "Gradient boosting reported the highest discrimination, with an AUC of 0.86.", evidence: ["E2"] },
      { text: "A deep network reported an AUC of 0.81 in a different cohort.", evidence: ["E3"] },
    ],
  ],
  findings: [
    [
      { text: "In 12,345 adults, XGBoost achieved an AUC of 0.86.", evidence: ["E1", "E2"] },
      { text: "XGBoost achieved an AUC of 0.95.", evidence: ["E2"] }, // invented number
      { text: "A retracted study reported an AUC of 0.99.", evidence: ["E5"] }, // retracted evidence is excluded
    ],
  ],
  comparison: [[{ text: "Machine learning is widely seen as transformative.", evidence: [] }]], // no citation
  limitations: [[{ text: "The deep network was not validated externally.", evidence: ["E4"] }]],
  gaps: [],
};

describe("synthesizeReport", () => {
  it("writes a verified report with deterministic methods, references and Markdown", async () => {
    const { adapter, calls } = writer(draft);
    const report = await synthesizeReport(input, adapter, { model: "claude-opus-5-5" });

    expect(ResearchReport.safeParse(report).success).toBe(true);
    if (report.status !== "written") throw new Error(`expected written, got ${report.status}`);

    expect(report.sections.map((s) => [s.id, s.generated, s.paragraphs.flat().length])).toEqual([
      ["summary", false, 2],
      ["methods", true, 9],
      ["findings", false, 1],
      ["comparison", false, 0],
      ["limitations", false, 1],
      ["gaps", false, 0],
      ["reviewLimitations", true, 6],
    ]);
    expect(report.rejected.map((r) => [r.section, r.reason, r.detail])).toEqual([
      ["findings", "number_not_in_evidence", "0.95"],
      ["findings", "unknown_evidence", undefined],
      ["comparison", "no_evidence", undefined],
    ]);

    // References are numbered by first citation, and retracted papers never appear.
    expect(report.references.map((r) => [r.number, r.paperId])).toEqual([
      [1, "pmid:1"],
      [2, "pmid:2"],
    ]);
    expect(report.sections[0]?.paragraphs[0]?.map((s) => s.references)).toEqual([[1], [2]]);
    expect(report.studies.map((s) => s.paperId)).toEqual(["pmid:1", "pmid:2"]);

    const methods = report.sections[1]!.paragraphs.flat().map((s) => s.text).join(" ");
    expect(methods).toContain("searched on 2026-11-16");
    expect(methods).toContain("PubMed returned the top 25 of 4,934 matching records, and Europe PMC could not be searched");
    expect(methods).toContain("1 item was discarded");
    expect(methods).toContain("Verified data were obtained for 2 of 3 selected papers");
    expect(methods).toContain("1 unsupported claim was removed");
    expect(methods).toContain("1 of 1 DOIs were confirmed");

    const reviewLimits = report.sections[6]!.paragraphs.flat().map((s) => s.text).join(" ");
    expect(reviewLimits).toContain("1 retracted paper was excluded");
    expect(reviewLimits).toContain("1 selected paper could not be extracted");

    // The model never saw the unsupported claim or the retracted evidence; it did see the reviewer note.
    const prompt = calls[0]!.prompt;
    expect(prompt).not.toContain("XGBoost beat everything");
    expect(prompt).not.toContain("0.99");
    expect(prompt).toContain("Reviewer note: AUCs come from different outcomes.");

    expect(report.markdown).toContain("# Machine learning for cardiovascular risk prediction");
    expect(report.markdown).toContain("Gradient boosting reported the highest discrimination, with an AUC of 0.86. [1] A deep network");
    expect(report.markdown).toContain("## Comparative analysis\n\n_No statements in this section passed verification._\n\n### Study characteristics");
    expect(report.markdown).toContain("| Smith 2023 [1] | prediction model | 12,345 |");
    expect(report.markdown).toContain("1. Smith J. XGBoost for CVD. Heart. 2023. doi:10.1/a. PMID: 1.");
    expect(report).toMatchObject({ model: "claude-opus-5-5", promptVersion: "synthesis-v1", attempts: 1, usage: { inputTokens: 4000, outputTokens: 1500 } });
  });

  it("skips without a model call when there is nothing reviewed to write from", async () => {
    const { adapter, calls } = writer(draft);
    expect(await synthesizeReport({ ...input, analysis: { status: "skipped", reason: "no_evidence" } }, adapter, { model: "m" })).toEqual({
      status: "skipped",
      reason: "no_analysis",
    });
    const allUnsupported: VerificationResult = {
      ...verification,
      claims: {
        ...verification.claims,
        status: "assessed",
        assessments: (verification.claims.status === "assessed" ? verification.claims.assessments : []).map((a) => ({ ...a, verdict: "unsupported" as const })),
        model: "m",
        promptVersion: "v",
        attempts: 1,
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    };
    expect(await synthesizeReport({ ...input, verification: allUnsupported }, adapter, { model: "m" })).toEqual({
      status: "skipped",
      reason: "no_supported_claims",
    });
    expect(calls).toEqual([]);
  });

  it("reports model failures", async () => {
    const { adapter } = writer("not json at all");
    expect(await synthesizeReport(input, adapter, { model: "m" })).toMatchObject({ status: "failed", reason: "invalid_output", attempts: 2 });
  });
});
