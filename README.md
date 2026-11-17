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
apps/web/           Web app (React, Vite, Tailwind); proxies /api to the worker in development
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
npm run dev        # starts the worker (:8787) and the web app (:5173) together
```

Open http://localhost:5173, then:

1. Click **Connect** and enter your Anthropic, OpenAI or Gemini key. It is verified, and you choose a model.
2. Ask a research question (or pick an example), choose how many papers to extract, and press **Run**.
3. Read the report on the right. Click any citation (`[1]`) or evidence chip (`E5`) to see the exact quotes a sentence rests on. The **Verifier** card lists everything that failed verification. Use **Download Markdown** or **Print / Save as PDF** to export.

While a run is in progress, a step checklist updates from events the pipeline streams as each step actually starts and finishes. Clients opt in with `accept: application/x-ndjson`; other clients still get a single JSON response. Pressing **Cancel** closes the stream, and the server stops before its next model call.

Your key stays in the browser tab's memory. Reloading the page disconnects.

Other commands:

```sh
npm run typecheck
npm test
npm run dev:worker   # API only
cp apps/worker/.dev.vars.example apps/worker/.dev.vars   # optional: set NCBI_EMAIL / NCBI_API_KEY
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

### Connecting an LLM provider (BYOK)

Users bring their own Anthropic, OpenAI or Gemini key. To verify a key and list the models it can use (no tokens are spent):

```sh
curl -X POST http://127.0.0.1:8787/api/provider/verify \
  -H 'content-type: application/json' \
  -H 'x-provider-key: <your key>' \
  -d '{"provider": "anthropic"}'
```

The response is `{"valid": true, "models": [...]}`, or `{"valid": false, "error": {"kind": "invalid_key" | "rate_limited" | ...}}`. It returns 502 only when the provider couldn't be reached.

How keys are handled (`apps/worker/src/providers/`):

- The key travels only in the `x-provider-key` header, never in a URL or JSON body, and it is never stored, logged or echoed back.
- It is wrapped in an `ApiKey` object that prints as `[REDACTED]` everywhere (`String()`, `JSON.stringify`, `console.log`). Only the provider adapter reads the real value, through an explicit `reveal()`.
- Error messages are written by Synthora. Provider error text is discarded because some providers echo part of the key.
- A new adapter is created for each request and never cached or shared between users.
- OpenAI calls set `store: false`, so research content isn't kept in the user's OpenAI account.

### Search and extract (end-to-end preview)

Runs search → rank → extraction for the top papers with your own key:

```sh
curl -X POST http://127.0.0.1:8787/api/research/preview \
  -H 'content-type: application/json' \
  -H 'x-provider-key: <your key>' \
  -d '{"query": "machine learning cardiovascular risk prediction", "provider": "anthropic", "model": "claude-opus-5-5", "topN": 3}'
```

For each paper, the extraction agent (`apps/worker/src/agents/extraction/`) pulls out the objective, study design, population, sample size, dataset, methods, findings with metrics, and limitations. Every item must carry a verbatim quote from the title or abstract, and plain code checks each quote against the source:

- **Quote not found in the paper** (or shorter than 8 characters) → the item is rejected.
- **Sample size or metric value not inside its quote** → the item is rejected.
- **Rejected items** are returned under `rejected` with a reason, so hallucinations are counted rather than hidden.
- **Prompt injection:** paper text is wrapped as data, and the prompt tells the model to ignore any instructions inside it.

The check proves that the quoted text exists in the paper. It does not prove the summarised `value` matches the quote; that is the citation-verification stage's job.

The evidence analysis agent (`apps/worker/src/agents/analysis/`) then compares the verified evidence across papers. The result is under `analysis`:

- **Deterministic, no LLM:**
  - an evidence catalog that gives every verified item an id (`E1`, `E2`, …),
  - a per-study comparison table (design, sample size, dataset, methods, metrics),
  - metrics grouped by name across studies (AUC synonyms merged, sorted by value).
- **From the model:** `findings`, `agreements`, `conflicts` and `gaps`. Each claim must cite evidence ids. A claim that cites an unknown id is rejected, and agreements and conflicts must cite at least two different papers. Rejected claims are listed with reasons.
- **If the model step fails,** the deterministic tables are still returned.

Citation verification (`apps/worker/src/agents/verification/`) then runs two checks:

- **Paper records (no LLM):**
  - Each DOI is looked up in Crossref, and the registered title is compared with the source record: `match`, `mismatch`, or `not_in_crossref` (some DOIs are registered elsewhere, so this is not proof of a bad DOI).
  - Papers PubMed marks as retracted are flagged.
  - These checks run alongside the model steps.
- **Claim support (one LLM call):** a reviewer prompt judges whether each claim's cited quotes actually support it: `supported`, `partially_supported` or `unsupported`, with a reason.
  - Unsupported claims are dropped from the report and listed in the Verifier card.
  - The reviewer is currently the same model that wrote the claims, so treat it as a check, not independent confirmation.

Report synthesis (`apps/worker/src/agents/synthesis/`) writes the final report:

- **Composed by code from what the pipeline actually did:** *Methods*, *Limitations of this review* and the numbered *References* (Vancouver style, built only from source metadata). They are accurate by construction.
- **Written by the model:** executive summary, findings, comparative analysis, limitations of the evidence, and research gaps. It works only from claims that passed review; retracted papers' evidence is excluded.
- **Every model-written sentence is checked by code:**
  - It must cite real evidence ids.
  - Every number in it must appear in the evidence it cites (small counts and publication years excepted). This catches invented or mis-transcribed statistics without a second model call.
  - Sentences that fail are removed and listed in the Verifier.
- **There is deliberately no "Background" section,** since it would require outside knowledge.
- **Export:** Markdown download, plus Print / Save as PDF with a clean print layout.

### Configuration

| Variable       | Kind   | Purpose                                                                 |
| -------------- | ------ | ----------------------------------------------------------------------- |
| `NCBI_EMAIL`   | var    | Contact address NCBI asks E-utilities clients to send (operator's own). |
| `NCBI_API_KEY` | secret | Optional. Raises the NCBI limit from 3 to 10 requests/second.           |
| `CROSSREF_MAILTO` | var | Optional operator contact; puts Crossref lookups in its faster polite pool. |

## Roadmap

1. ~~Literature discovery: PubMed + Europe PMC, normalisation, deduplication~~
2. ~~Relevance ranking of retrieved papers (lexical; semantic ranking to follow with BYOK)~~
3. ~~BYOK provider adapters (OpenAI, Anthropic, Gemini) with key verification~~
4. ~~Paper extraction agent with schema-validated, quote-verified output~~
5. ~~Evidence analysis (cross-paper comparison with cited claims)~~
6. ~~Citation verification (Crossref record checks, retraction flags, claim support review)~~
7. ~~Report synthesis (cited narrative report, number checks, Markdown/PDF export)~~
8. ~~Live progress in the UI (streamed pipeline events, step checklist, cancellation stops further model calls)~~
   Next: durable orchestration (Cloudflare Workflows) so runs survive a closed tab
9. ~~Web app (preview)~~
10. Evaluation suite (retrieval precision/recall, citation accuracy, hallucination rate)

The original long-form plan is in [docs/blueprint.md](docs/blueprint.md); architecture decisions are in [docs/decisions](docs/decisions).
