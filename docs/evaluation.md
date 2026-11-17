# Evaluation

Synthora is evaluated on two questions: **does it find the right papers**, and **does it avoid making things up**.

## Retrieval quality (needs relevance judgments)

For each question in a dataset (`research/datasets/*.json`), candidate papers are judged 0 (not relevant), 1 (partially relevant) or 2 (highly relevant). Retrieval is scored on the ranked list of papers with abstracts, which is the list the pipeline actually draws from:

| Metric | Meaning |
|---|---|
| Precision@10 | Share of the top 10 that are relevant (unjudged papers count as not relevant) |
| Recall@10 | Share of the known relevant papers that appear in the top 10 |
| nDCG@10 | Ranking quality with graded relevance: highly relevant papers near the top score most |
| MRR | 1 / rank of the first relevant paper |

**Pooling.** As in TREC-style evaluation, judgments come from pooling the top results of every system being compared (the question as written, and the Research Planner). Recall is only meaningful against a pool that includes every system's results.

**Label quality.** Every question records `labelledBy`. The seed set (`research/datasets/seed.json`, five questions, 50 judgments) has **draft labels written by Claude from titles and abstract snippets**. Treat its numbers as indicative until a domain expert has reviewed them.

## Reliability (no labels needed)

Each check in the pipeline records what it rejected, so fabrication can be counted directly on any question:

| Rate | What it counts |
|---|---|
| Extraction rejected | Extracted items whose quote was not in the abstract, or whose number was not in its quote |
| Fabricated citations | Analysis claims citing evidence ids that do not exist |
| Unsupported claims | Claims the reviewer judged unsupported by their cited quotes |
| Unsupported numbers | Report sentences stating a number absent from their cited evidence |
| Sentences rejected | Report sentences removed for any reason |

These measure what verification *caught*. Errors that pass every check (for example, a faithful-looking paraphrase of the wrong quote) are not counted. Estimating those requires human review of a sample of reports.

Rates are aggregated from counts across questions, not averaged per question, so a question with many claims weighs more than one with few.

## Running it

```sh
# Retrieval with the question as written (no model key needed)
npm run eval -- retrieval

# Add the Research Planner: model steps read the key from the environment, never from arguments or files
$env:SYNTHORA_EVAL_KEY = "<your key>"          # PowerShell; use export in bash
npm run eval -- pool --provider anthropic --model claude-opus-5-5        # pool the planner's results for judging
npm run eval -- retrieval --provider anthropic --model claude-opus-5-5   # baseline vs planner
npm run eval -- full --provider anthropic --model claude-opus-5-5 --topN 5 --label opus-top5
```

Each run writes `results.json` and `summary.md` to `research/experiments/<timestamp>-<label>/`. Results never contain the key.

Options: `--dataset <path>`, `--only <question-id>`, `--topN <n>` (full runs), `--pool <n>` (candidates per system when pooling), `--label <name>`.

## Adding questions

1. Add an entry to the dataset with `"judgments": {}`, `"pending": []` and `"labelledBy": "unlabelled"`.
2. Run `pool` (with a key, so the planner's results are included).
3. Judge each pending paper, move it into `judgments`, and record who judged it in `labelledBy`.

## Baseline results (seed set, question as written)

From `research/experiments/2026-11-17T05-42-15-baseline-seed/`, with draft labels:

| Question | P@10 | nDCG@10 |
|---|---|---|
| ml-cvd-risk | 0.50 | 0.94 |
| dl-diabetic-retinopathy | 0.90 | 0.91 |
| sglt2-heart-failure | 0.90 | 0.76 |
| llm-clinical-notes | 0.20 | 0.42 |
| exercise-depression-older | 0.80 | 0.92 |
| **Mean** | **0.66** | **0.79** |

Recall is omitted: this pool was built from the baseline alone, so its recall is trivially 1.0. Searching the question as written works well for trial and diagnostic-accuracy questions, and poorly for the clinical NLP question, where generic terms ("large language models", "clinical") pull in unrelated AI papers. That gap is what the Research Planner is meant to close; measuring whether it does needs a run with a model key.
