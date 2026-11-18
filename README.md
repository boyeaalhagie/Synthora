# Synthora

An agentic research assistant that takes a clinical research question to a structured, evidence-backed report, where **every claim traces back to a quote from a real publication** and **every model output is checked by code before it is used**.

Synthora is a research-support tool. It does not diagnose and does not replace clinical judgement.

## What it does

Ask a question. Six agents then plan the search, search PubMed and Europe PMC, extract each top paper, compare the evidence, verify citations, and write a report. You watch the steps tick off live, then read a report in which you can click any citation to see the exact quotes behind it.

| Agent | Model's job | What code guarantees |
|---|---|---|
| Research Planner | Concepts and synonyms | Queries are built by code; terms can't inject query syntax |
| Literature Search | — | Two sources, deduplication, BM25 + reciprocal rank fusion |
| Paper Extraction | Structured study data | Every item quotes the abstract verbatim; quotes and numbers are checked |
| Evidence Analysis | Findings, agreements, conflicts, gaps | Claims must cite real evidence; comparison tables are built by code |
| Citation Verification | Does each quote support its claim? | Crossref DOI checks, retraction flags; unsupported claims dropped |
| Research Synthesis | The narrative | Methods and references written by code; every number must be in its cited evidence |

Everything rejected along the way is shown in the **Verifier** card, and counted by the [evaluation suite](docs/evaluation.md).

**Bring your own key.** Users connect their own Anthropic, OpenAI or Gemini key. It stays in browser memory, travels only in a request header, and is never stored or logged.

## Getting started

Requires Node 20+.

```sh
npm install
npm run dev        # worker (:8787) and web app (:5173); applies local database migrations first
```

Open http://localhost:5173, click **Connect** to add your key, ask a question (or pick an example), and press **Run**. Start with 2–3 papers: each costs one or two model calls, plus four for planning, analysis, review and writing.

Completed research is saved in your browser's session (no account needed) and listed in the sidebar.

```sh
npm run typecheck
npm test                          # 228 tests
npm run eval -- retrieval         # retrieval quality on the seed dataset (see docs/evaluation.md)
npm run deploy                    # see docs/deployment.md first
```

Optional operator settings for local development: copy `apps/worker/.dev.vars.example` to `apps/worker/.dev.vars`.

## Documentation

- [Architecture](docs/architecture.md): pipeline, verification, key handling, storage, security
- [Evaluation](docs/evaluation.md): metrics, dataset, how to run, baseline results
- [Deployment](docs/deployment.md): Cloudflare setup step by step
- [Demo script](docs/demo-script.md): a five-minute walkthrough
- [OpenShell sandbox](sandbox/openshell/README.md): run the pipeline in an NVIDIA OpenShell sandbox with enforced network rules
- [Decisions](docs/decisions): why TypeScript on Workers; why no durable workflows with BYOK; how OpenShell fits
- [Blueprint](docs/blueprint.md): the original plan

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/provider/verify` | Verify a key (header `x-provider-key`) and list its models; spends no tokens |
| POST | `/api/research/preview` | Run the pipeline. Send `accept: application/x-ndjson` for live progress events |
| GET | `/api/research` | List this browser's saved research |
| GET / DELETE | `/api/research/:id` | Open or delete a saved run |
| POST | `/api/literature/search` | Search and rank only (no model) |
| GET | `/api/config`, `/api/health` | Public configuration; health check |

## Status

| Blueprint deliverable | Status |
|---|---|
| Six specialised agents | ✅ |
| Multi-provider BYOK | ✅ |
| PubMed and Europe PMC integration | ✅ |
| Automated extraction and comparison | ✅ |
| Evidence-backed reports with citations | ✅ Markdown and PDF export |
| Live agent execution tracking | ✅ Streamed; runs stop if the tab closes ([why](docs/decisions/0002-no-durable-workflows-with-byok.md)) |
| Evaluation framework with metrics | ✅ Seed labels are drafts pending expert review |
| Security and failure-handling tests | ✅ Rate limits, Turnstile, CSP, key-handling tests |
| Hosted on Cloudflare | 🟡 Deployment is configured and dry-run tested; needs your Cloudflare account ([guide](docs/deployment.md)) |
| NVIDIA OpenShell sandboxing | 🟡 Sandboxed CLI, image and enforced policy are built and tested in code; not yet run on a Linux host ([guide](sandbox/openshell/README.md)) |
| Architecture docs and demo video | 🟡 Docs and demo script are written; the video needs recording |
