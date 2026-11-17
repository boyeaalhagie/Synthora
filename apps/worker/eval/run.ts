/**
 * Synthora evaluation CLI.
 *
 *   npm run eval -- pool       Gather candidate papers for questions that need relevance judgments.
 *   npm run eval -- retrieval  Score search quality (P@10, R@10, nDCG@10, MRR). With a key, also compares
 *                              the Research Planner against searching the question as written.
 *   npm run eval -- full       Run the whole pipeline on every question and report retrieval, reliability,
 *                              latency and token usage.
 *
 * Model steps need SYNTHORA_EVAL_KEY (your provider key) in the environment, plus --provider and --model.
 * The key is read from the environment only; it is never written to disk or into results.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { LlmProvider, type ResearchPreviewResult } from "@synthora/schemas";
import { planSearch } from "../src/agents/planner/agent.js";
import { fallbackQueries } from "../src/agents/planner/queries.js";
import { CrossrefClient } from "../src/literature/crossref.js";
import { EuropePmcClient } from "../src/literature/europepmc.js";
import { MinIntervalLimiter, type FetchFn } from "../src/lib/http.js";
import { PubMedClient } from "../src/literature/pubmed.js";
import { searchLiterature } from "../src/literature/search.js";
import { ApiKey, createAdapter } from "../src/providers/index.js";
import { runResearch, type PipelineDeps } from "../src/research/pipeline.js";
import { loadDataset, saveDataset, type EvalQuestion } from "./dataset.js";
import { mean, rate, reliabilityMetrics, retrievalMetrics, sumRates, type ReliabilityMetrics, type RetrievalMetrics } from "./metrics.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const K = 10;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    dataset: { type: "string", default: join(ROOT, "research/datasets/seed.json") },
    provider: { type: "string" },
    model: { type: "string" },
    topN: { type: "string", default: "5" },
    only: { type: "string" },
    label: { type: "string", default: "run" },
    pool: { type: "string", default: "20" },
  },
});
const command = positionals[0];

const fetchFn: FetchFn = (input, init) => fetch(input, init);
const literatureClients = [
  new PubMedClient({ tool: "synthora-eval", email: process.env.NCBI_EMAIL || undefined, apiKey: process.env.NCBI_API_KEY || undefined }, { fetch: fetchFn, limiter: new MinIntervalLimiter(process.env.NCBI_API_KEY ? 110 : 350) }),
  new EuropePmcClient({ fetch: fetchFn, limiter: new MinIntervalLimiter(100) }),
];

function modelAccess() {
  const key = ApiKey.parse(process.env.SYNTHORA_EVAL_KEY);
  if (!key) return null;
  const provider = LlmProvider.safeParse(values.provider);
  if (!provider.success || !values.model) throw new Error("With SYNTHORA_EVAL_KEY set, pass --provider (anthropic|openai|gemini) and --model.");
  return { key, provider: provider.data, model: values.model, adapter: createAdapter(provider.data, key) };
}

async function rankedIds(question: string, queries = fallbackQueries(question)) {
  const result = await searchLiterature({ query: question, limitPerSource: 25, sources: ["pubmed", "europepmc"] }, literatureClients, queries);
  // The pipeline can only use papers with abstracts, so retrieval is scored on the same list.
  return result.papers.filter((p) => p.abstract);
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const fmt = (x: number) => x.toFixed(3);

function outputDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = join(ROOT, "research/experiments", `${stamp}-${values.label}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function retrievalTable(rows: Array<{ id: string; m: RetrievalMetrics }>) {
  const lines = ["| Question | P@10 | R@10 | nDCG@10 | RR | Unjudged in top 10 |", "|---|---|---|---|---|---|"];
  for (const { id, m } of rows) lines.push(`| ${id} | ${fmt(m.precisionAtK)} | ${fmt(m.recallAtK)} | ${fmt(m.ndcgAtK)} | ${fmt(m.reciprocalRank)} | ${m.unjudgedInTopK} |`);
  const avg = (f: (m: RetrievalMetrics) => number) => fmt(mean(rows.map((r) => f(r.m))));
  lines.push(`| **Mean** | **${avg((m) => m.precisionAtK)}** | **${avg((m) => m.recallAtK)}** | **${avg((m) => m.ndcgAtK)}** | **${avg((m) => m.reciprocalRank)}** | ${rows.reduce((n, r) => n + r.m.unjudgedInTopK, 0)} |`);
  return lines.join("\n");
}

const judged = (q: EvalQuestion) => Object.values(q.judgments).some((g) => g >= 1);

async function pool() {
  const dataset = loadDataset(values.dataset);
  const access = modelAccess();
  const size = Number(values.pool);
  for (const q of dataset.questions) {
    if (values.only && q.id !== values.only) continue;
    const lists = [await rankedIds(q.question)];
    if (access) {
      const plan = await planSearch(q.question, access.adapter, { model: access.model, now: new Date() });
      lists.push(await rankedIds(q.question, plan.queries));
    }
    // Pool the top of every system's ranking, as in TREC-style evaluation, so no system is judged only on papers another system found.
    const seen = new Set([...Object.keys(q.judgments), ...q.pending.map((p) => p.id)]);
    for (const paper of lists.flatMap((l) => l.slice(0, size))) {
      if (seen.has(paper.id)) continue;
      seen.add(paper.id);
      q.pending.push({ id: paper.id, title: paper.title, ...(paper.year !== undefined && { year: paper.year }), ...(paper.abstract && { snippet: paper.abstract.slice(0, 400) }) });
    }
    console.log(`${q.id}: ${q.pending.length} papers awaiting judgment`);
  }
  saveDataset(values.dataset, dataset);
  console.log(`\nJudge each pending paper (0 not relevant, 1 partially, 2 highly), move it into "judgments", and update "labelledBy".`);
}

async function retrieval() {
  const dataset = loadDataset(values.dataset);
  const access = modelAccess();
  const questions = dataset.questions.filter((q) => judged(q) && (!values.only || q.id === values.only));
  if (questions.length === 0) throw new Error("No questions have relevance judgments yet. Run `pool` and judge the candidates first.");

  const baseline: Array<{ id: string; m: RetrievalMetrics }> = [];
  const planned: Array<{ id: string; m: RetrievalMetrics }> = [];
  for (const q of questions) {
    baseline.push({ id: q.id, m: retrievalMetrics((await rankedIds(q.question)).map((p) => p.id), q.judgments, K) });
    if (access) {
      const plan = await planSearch(q.question, access.adapter, { model: access.model, now: new Date() });
      planned.push({ id: q.id, m: retrievalMetrics((await rankedIds(q.question, plan.queries)).map((p) => p.id), q.judgments, K) });
    }
    console.log(`${q.id} done`);
  }

  const dir = outputDir();
  const md = [
    `# Retrieval evaluation: ${dataset.name}`,
    `${questions.length} judged questions. Labels: ${[...new Set(questions.map((q) => q.labelledBy.replace(/\.$/, "")))].join("; ")}.`,
    "Recall is measured against the judged pool only. If the pool was built from a single system's results, that system's recall is trivially 1.0; pool with the planner as well (`pool` with a key) before comparing recall.",
    "## Question as written (baseline)",
    retrievalTable(baseline),
    ...(planned.length ? [`## Research Planner (${values.provider} · ${values.model})`, retrievalTable(planned)] : ["_Set SYNTHORA_EVAL_KEY with --provider and --model to compare the Research Planner._"]),
  ].join("\n\n");
  writeFileSync(join(dir, "results.json"), JSON.stringify({ kind: "retrieval", dataset: dataset.name, k: K, baseline, planned, model: values.model ?? null }, null, 2));
  writeFileSync(join(dir, "summary.md"), `${md}\n`);
  console.log(`\n${md}\n\nWritten to ${dir}`);
}

async function full() {
  const dataset = loadDataset(values.dataset);
  const access = modelAccess();
  if (!access) throw new Error("`full` runs the model steps: set SYNTHORA_EVAL_KEY and pass --provider and --model.");
  const deps: PipelineDeps = {
    literatureClients,
    createAdapter: (provider, key) => createAdapter(provider, key),
    crossref: new CrossrefClient({ mailto: process.env.CROSSREF_MAILTO || undefined }, { fetch: fetchFn, limiter: new MinIntervalLimiter(100) }),
  };

  type Row = { id: string; seconds: number; tokens: number; retrieval: RetrievalMetrics | null; reliability: ReliabilityMetrics; report: string };
  const rows: Row[] = [];
  const results: Record<string, ResearchPreviewResult> = {};
  for (const q of dataset.questions) {
    if (values.only && q.id !== values.only) continue;
    const started = performance.now();
    const outcome = await runResearch({ query: q.question, provider: access.provider, model: access.model, topN: Number(values.topN) }, access.key, deps, {
      emit: (e) => e.type === "step" && e.status !== "running" && console.log(`  ${q.id} ${e.step}: ${e.status}${e.detail ? ` (${e.detail})` : ""}`),
      isCancelled: () => false,
    });
    if (!outcome.ok) {
      console.log(`${q.id} failed: ${outcome.error}`);
      continue;
    }
    const r = outcome.result;
    results[q.id] = r;
    rows.push({
      id: q.id,
      seconds: (performance.now() - started) / 1000,
      tokens: r.usage.inputTokens + r.usage.outputTokens,
      retrieval: judged(q) ? retrievalMetrics(r.papers.map((p) => p.id), q.judgments, Math.min(K, r.papers.length) || K) : null,
      reliability: reliabilityMetrics(r),
      report: r.report.status,
    });
  }

  const total = (pick: (m: ReliabilityMetrics) => { count: number; total: number }) => sumRates(rows.map((r) => pick(r.reliability)));
  const line = (label: string, pick: (m: ReliabilityMetrics) => { count: number; total: number }) => {
    const t = total(pick);
    return `| ${label} | ${t.count} / ${t.total} | ${pct(rate(t))} |`;
  };
  const md = [
    `# Full pipeline evaluation: ${dataset.name}`,
    `${access.provider} · ${access.model} · top ${values.topN} papers per question · ${rows.length} questions completed.`,
    "## Reliability (caught by verification; lower is better)",
    "| Check | Caught / checked | Rate |\n|---|---|---|",
    [
      line("Extracted items whose quote was not in the abstract", (m) => m.extractionRejected),
      line("Claims citing evidence that does not exist", (m) => m.fabricatedCitations),
      line("Claims judged unsupported by their quotes", (m) => m.unsupportedClaims),
      line("Report sentences with numbers not in their evidence", (m) => m.unsupportedNumbers),
      line("Report sentences removed (any reason)", (m) => m.sentencesRejected),
    ].join("\n"),
    "## Per question",
    "| Question | Report | Seconds | Tokens | P@k | nDCG@k |\n|---|---|---|---|---|---|",
    rows.map((r) => `| ${r.id} | ${r.report} | ${r.seconds.toFixed(0)} | ${r.tokens.toLocaleString("en-US")} | ${r.retrieval ? fmt(r.retrieval.precisionAtK) : "—"} | ${r.retrieval ? fmt(r.retrieval.ndcgAtK) : "—"} |`).join("\n"),
    `Mean latency ${mean(rows.map((r) => r.seconds)).toFixed(0)} s; mean tokens ${Math.round(mean(rows.map((r) => r.tokens))).toLocaleString("en-US")} per question. Retrieval here is scored on the papers the pipeline selected (k = topN).`,
  ].join("\n\n");

  const dir = outputDir();
  writeFileSync(join(dir, "results.json"), JSON.stringify({ kind: "full", dataset: dataset.name, provider: access.provider, model: access.model, rows, results }, null, 2));
  writeFileSync(join(dir, "summary.md"), `${md}\n`);
  console.log(`\n${md}\n\nWritten to ${dir}`);
}

const commands: Record<string, () => Promise<void>> = { pool, retrieval, full };
const run = command ? commands[command] : undefined;
if (!run) {
  console.error("Usage: npm run eval -- <pool|retrieval|full> [--dataset path] [--only id] [--provider p --model m] [--topN n] [--label name]");
  process.exit(1);
}
run().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
