# Synthora

An agentic research assistant that takes a clinical research question to a structured, evidence-backed report, where every claim traces back to a real publication.

Synthora is a research-support tool. It does not diagnose and does not replace clinical judgement.

> Status: early development. The literature discovery layer works; agents, BYOK and the web app are not built yet. See [the roadmap](#roadmap).

## Principles

- **No invented sources.** Identifiers (PMID, DOI, PMCID) are only ever copied from source APIs. Records without one are dropped.
- **Deterministic code first.** Search, deduplication and identifier checks are plain code. LLMs are reserved for extraction, comparison and writing.
- **Bring your own key.** Users supply their own LLM provider key per session. Keys are never stored or logged.

## Repository layout

```
apps/worker/        Cloudflare Worker: API and research pipeline (TypeScript)
  src/lib/          HTTP retry/rate limiting, text + identifier normalisation
  src/literature/   PubMed and Europe PMC clients, deduplication, search
  test/             Vitest suites; fixtures are recorded real API responses
packages/schemas/   Zod schemas shared by every stage (Paper, search request/result)
docs/               Blueprint, architecture decisions, reference images
```

## Getting started

Requires Node 20+.

```sh
npm install
npm run typecheck
npm test

# Run the worker locally (http://127.0.0.1:8787)
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # set NCBI_EMAIL
npm run dev:worker
```

Try a search:

```sh
curl -X POST http://127.0.0.1:8787/api/literature/search \
  -H 'content-type: application/json' \
  -d '{"query": "machine learning cardiovascular risk prediction", "limitPerSource": 10}'
```

Request fields: `query` (3–1000 chars), `limitPerSource` (1–100, default 25), `sources` (`["pubmed", "europepmc"]` by default).
The response lists deduplicated `papers`, most relevant first, and a per-source `outcomes` entry. If one source fails you still get partial results; if all fail the status is 502.

Each paper carries a `relevance` breakdown. Ranking is deterministic: BM25 over title and abstract (computed within the retrieved set) is fused with each source's own ranking using reciprocal rank fusion, so papers both sources return rank higher. See `apps/worker/src/literature/rank.ts`.

### Configuration

| Variable       | Kind   | Purpose                                                                 |
| -------------- | ------ | ----------------------------------------------------------------------- |
| `NCBI_EMAIL`   | var    | Contact address NCBI asks E-utilities clients to send (operator's own). |
| `NCBI_API_KEY` | secret | Optional. Raises the NCBI limit from 3 to 10 requests/second.           |

## Roadmap

1. ~~Literature discovery: PubMed + Europe PMC, normalisation, deduplication~~
2. ~~Relevance ranking of retrieved papers (lexical; semantic ranking to follow with BYOK)~~
3. BYOK provider adapters (OpenAI, Anthropic, Gemini) with key verification
4. Paper extraction agent with schema-validated output
5. Evidence analysis, citation verification (Crossref), report synthesis
6. Durable orchestration (Cloudflare Workflows) with SSE progress
7. Web app
8. Evaluation suite (retrieval precision/recall, citation accuracy, hallucination rate)

The original long-form plan is in [docs/blueprint.md](docs/blueprint.md); architecture decisions are in [docs/decisions](docs/decisions).
