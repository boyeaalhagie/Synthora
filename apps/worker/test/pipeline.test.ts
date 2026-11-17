import { describe, expect, it } from "vitest";
import { ProgressEvent, type LlmProvider, type Paper } from "@synthora/schemas";
import { SYSTEM_PROMPT as ANALYSIS } from "../src/agents/analysis/prompt.js";
import { SYSTEM_PROMPT as EXTRACTION } from "../src/agents/extraction/prompt.js";
import { SYSTEM_PROMPT as PLANNER } from "../src/agents/planner/agent.js";
import { SYSTEM_PROMPT as SYNTHESIS } from "../src/agents/synthesis/prompt.js";
import { SYSTEM_PROMPT as REVIEW } from "../src/agents/verification/prompt.js";
import { handleRequest } from "../src/index.js";
import { ApiKey } from "../src/providers/api-key.js";
import type { GenerateRequest, ProviderAdapter } from "../src/providers/types.js";
import { runResearch, type PipelineDeps } from "../src/research/pipeline.js";
import { paper } from "./helpers.js";

const KEY = "sk-test-0123456789abcdefghijklmnop";
const ABSTRACT = "We studied 12,345 adults. XGBoost achieved an AUC of 0.86 for cardiovascular events.";

const plan = {
  concepts: [
    { name: "machine learning", terms: ["machine learning", "XGBoost"] },
    { name: "cardiovascular", terms: ["cardiovascular events"] },
  ],
  yearFrom: null,
  yearTo: null,
};
const extraction = {
  objective: null,
  studyDesign: null,
  population: null,
  sampleSize: { value: 12345, quote: "We studied 12,345 adults." },
  dataset: null,
  methods: [],
  findings: [{ value: "XGBoost AUC 0.86", quote: "XGBoost achieved an AUC of 0.86", metrics: [{ name: "AUC", value: "0.86" }] }],
  limitations: [],
};
const analysis = { findings: [{ statement: "XGBoost reached an AUC of 0.86.", evidence: ["E2"] }], agreements: [], conflicts: [], gaps: [] };
const review = { assessments: [{ claimId: "C1", verdict: "supported", explanation: "Stated directly." }] };
const report = {
  title: "XGBoost for cardiovascular risk",
  summary: [[{ text: "XGBoost achieved an AUC of 0.86 in 12,345 adults.", evidence: ["E1", "E2"] }]],
  findings: [],
  comparison: [],
  limitations: [],
  gaps: [],
};

/** Answers each agent's prompt with a valid response, recognising the agent by its system prompt. */
function scriptedModel() {
  const calls: GenerateRequest[] = [];
  const outputs = new Map<string, unknown>([
    [PLANNER, plan],
    [EXTRACTION, extraction],
    [ANALYSIS, analysis],
    [REVIEW, review],
    [SYNTHESIS, report],
  ]);
  const createAdapter = (provider: LlmProvider): ProviderAdapter => ({
    provider,
    async listModels() {
      return [];
    },
    async generate(request) {
      calls.push(request);
      return { text: JSON.stringify(outputs.get(request.system!)), stopReason: "end", model: "m", usage: { inputTokens: 10, outputTokens: 5 } };
    },
  });
  return { createAdapter, calls };
}

function deps(papers: Paper[], createAdapter: PipelineDeps["createAdapter"]): PipelineDeps {
  return {
    literatureClients: [
      { source: "pubmed", search: async () => ({ totalHits: papers.length, papers }) },
      { source: "europepmc", search: async () => ({ totalHits: 0, papers: [] }) },
    ],
    createAdapter,
    crossref: { work: async () => undefined },
  };
}

const studies = [paper({ id: "pmid:1", pmid: "1", title: "XGBoost study", abstract: ABSTRACT, authors: ["Smith J"], year: 2023 })];
const params = { query: "ml cvd", provider: "anthropic" as const, model: "m", topN: 1 };
const key = ApiKey.parse(KEY)!;

describe("runResearch", () => {
  it("runs every step and emits real progress in order", async () => {
    const model = scriptedModel();
    const events: ProgressEvent[] = [];
    const outcome = await runResearch(params, key, deps(studies, model.createAdapter), { emit: (e) => events.push(e), isCancelled: () => false });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.report.status).toBe("written");
    expect(model.calls.map((c) => c.system)).toEqual([PLANNER, EXTRACTION, ANALYSIS, REVIEW, SYNTHESIS]);
    expect(outcome.result.usage).toEqual({ inputTokens: 50, outputTokens: 25 });
    expect(outcome.result.plan.status).toBe("planned");

    expect(events.map((e) => (e.type === "step" ? `${e.step}:${e.status}` : e.type === "extract" ? `extract ${e.completed}/${e.total}` : e.type))).toEqual([
      "plan:running",
      "plan:done",
      "search:running",
      "search:done",
      "extract:running",
      "extract 0/1",
      "extract 1/1",
      "extract:done",
      "analyze:running",
      "analyze:done",
      "verify:running",
      "verify:done",
      "report:running",
      "report:done",
    ]);
    expect(events.find((e) => e.type === "step" && e.step === "search" && e.status === "done")).toMatchObject({ detail: "1 record from 2 sources; top 1 selected" });
    expect(events.at(-1)).toMatchObject({ detail: "1 cited sentence, 1 reference" });
    for (const e of events) expect(ProgressEvent.safeParse(e).success).toBe(true);
  });

  it("stops before spending more tokens once the run is cancelled", async () => {
    const model = scriptedModel();
    let cancelled = false;
    const outcome = await runResearch(params, key, deps(studies, model.createAdapter), {
      emit: (e) => {
        if (e.type === "step" && e.step === "search" && e.status === "done") cancelled = true;
      },
      isCancelled: () => cancelled,
    });
    expect(outcome).toEqual({ ok: false, status: 499, error: "The run was cancelled." });
    expect(model.calls.map((c) => c.system)).toEqual([PLANNER]); // nothing after the cancellation point
  });

  it("searches the question as written when planning is disabled", async () => {
    const model = scriptedModel();
    const queries: string[] = [];
    const d = deps(studies, model.createAdapter);
    const recording: PipelineDeps = {
      ...d,
      literatureClients: d.literatureClients.map((c) => ({ source: c.source, search: (q: string, n: number) => (queries.push(q), c.search(q, n)) })),
    };
    const outcome = await runResearch({ ...params, planner: false }, key, recording, { emit: () => {}, isCancelled: () => false });
    expect(outcome.ok && outcome.result.plan).toMatchObject({ status: "fallback", reason: "Planning was disabled for this run." });
    expect(queries).toEqual(["ml cvd", "ml cvd"]);
    expect(model.calls[0]?.system).toBe(EXTRACTION);
  });

  it("sends each source its own planned query", async () => {
    const model = scriptedModel();
    const queries: Record<string, string> = {};
    const d = deps(studies, model.createAdapter);
    const recording: PipelineDeps = {
      ...d,
      literatureClients: d.literatureClients.map((c) => ({ source: c.source, search: (q: string, n: number) => ((queries[c.source] = q), c.search(q, n)) })),
    };
    await runResearch(params, key, recording, { emit: () => {}, isCancelled: () => false });
    expect(queries).toEqual({
      pubmed: '("machine learning"[tiab] OR "XGBoost"[tiab]) AND ("cardiovascular events"[tiab])',
      europepmc: '("machine learning" OR "XGBoost") AND ("cardiovascular events")',
    });
  });

  it("falls back to the question as written when the planned search finds nothing", async () => {
    const model = scriptedModel();
    const queries: string[] = [];
    const d = deps(studies, model.createAdapter);
    const recording: PipelineDeps = {
      ...d,
      // Planned queries (with quotes) find nothing; the plain question finds the study.
      literatureClients: d.literatureClients.map((c) => ({
        source: c.source,
        search: async (q: string, n: number) => (queries.push(q), q.includes('"') ? { totalHits: 0, papers: [] } : c.search(q, n)),
      })),
    };
    const outcome = await runResearch(params, key, recording, { emit: () => {}, isCancelled: () => false });
    expect(outcome.ok && outcome.result.plan).toMatchObject({ status: "fallback", reason: "The planned search found no papers with abstracts." });
    expect(outcome.ok && outcome.result.papers.map((p) => p.id)).toEqual(["pmid:1"]);
    expect(queries.slice(2)).toEqual(["ml cvd", "ml cvd"]);
  });

  it("reports a failed search without extracting anything", async () => {
    const model = scriptedModel();
    const failing: PipelineDeps = {
      ...deps([], model.createAdapter),
      literatureClients: [
        { source: "pubmed", search: async () => Promise.reject(new Error("down")) },
        { source: "europepmc", search: async () => Promise.reject(new Error("down")) },
      ],
    };
    const events: ProgressEvent[] = [];
    const outcome = await runResearch(params, key, failing, { emit: (e) => events.push(e), isCancelled: () => false });
    expect(outcome).toMatchObject({ ok: false, status: 502 });
    expect(events.at(-1)).toMatchObject({ step: "search", status: "failed" });
    expect(model.calls.map((c) => c.system)).toEqual([PLANNER]);
  });
});

describe("POST /api/research/preview (streaming)", () => {
  it("streams NDJSON progress ending in the result when the client asks for it", async () => {
    const model = scriptedModel();
    const res = await handleRequest(
      new Request("https://synthora.test/api/research/preview", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson", "x-provider-key": KEY },
        body: JSON.stringify(params),
      }),
      deps(studies, model.createAdapter),
    );
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const lines = (await res.text()).trim().split("\n").map((l) => ProgressEvent.parse(JSON.parse(l)));
    expect(lines[0]).toEqual({ type: "step", step: "plan", status: "running" });
    const last = lines.at(-1);
    expect(last?.type).toBe("result");
    expect(last?.type === "result" && last.result.report.status).toBe("written");
    expect(JSON.stringify(lines)).not.toContain(KEY);
  });

  it("still validates the request before streaming", async () => {
    const res = await handleRequest(
      new Request("https://synthora.test/api/research/preview", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson" },
        body: JSON.stringify(params),
      }),
      deps(studies, scriptedModel().createAdapter),
    );
    expect(res.status).toBe(400);
  });
});
