# Demo script (about 5 minutes)

A walkthrough for recording the project demo. Use a question with 3 papers so the run finishes in one to two minutes. Rehearse once first, so your key is already verified and the cost is known.

## 1. The problem (30 s)

> "Literature reviews are slow, and asking a chatbot is fast but untrustworthy. It invents papers, misquotes statistics, and you can't tell which claims are real. Synthora is an agentic research assistant where every claim is traceable to a quote from a real paper, and every model output is checked by code before it's used."

## 2. Bring your own key (30 s)

- Click **Connect**, choose a provider, paste a key, **Connect and verify**, pick a model.
- Say: "The key lives only in this tab's memory and goes in a request header. It's never stored or logged. The server even prints it as REDACTED if it's ever logged by mistake."

## 3. Run a question (1.5 min)

- Pick the cardiovascular example, set **Papers to extract** to 3, press **Run**.
- While the checklist fills in, narrate the six agents as they tick off:
  - **Plan:** the question becomes concept groups of synonyms, and code builds the PubMed query, so the model can't inject query syntax.
  - **Search:** PubMed and Europe PMC, deduplicated, ranked with BM25 fused with each source's ranking.
  - **Extract:** each paper's study design, sample size and findings, each with a verbatim quote.
  - **Analyse, Verify, Write.**
- Point out that the progress is real, streamed from the server as each step happens, and that Cancel stops spending tokens.

## 4. The report (1.5 min)

- **Report tab:** click a `[1]` citation to open the exact quotes behind that sentence.
- Point at the **Methods** section: "This is written by code from what actually happened (the search strategy, record counts, what was discarded), so it can't be wrong."
- Open **Download Markdown** or **Print / Save as PDF**.
- **Studies** and **Metrics** tabs: comparison tables built by code, not the model.
- **Papers** tab: DOI verified against Crossref, preprint and retraction flags.

## 5. Verification (1 min)

- Expand the **Verifier** card: "These are things the model produced that code rejected: a quote that wasn't in the abstract, a claim citing evidence that doesn't exist, a sentence with a number its evidence doesn't contain. Rejected items never reach the report."
- Expand the steps to show the search plan and PubMed query.

## 6. Evaluation and engineering (30 s)

- Show `docs/evaluation.md` or a `summary.md` from `research/experiments/`: retrieval metrics (P@10, nDCG@10) and the reliability rates counted from the verification records.
- Close with: "It's deployed as a single Cloudflare Worker with D1, rate limiting and bot protection, and covered by more than 200 tests."

## Before recording

- Reload the page so the sidebar holds only what you want to show.
- Use a fresh browser profile or private window if you don't want saved sessions on screen.
- Have the repository open on GitHub in another tab for the architecture diagram (`docs/architecture.md`).
