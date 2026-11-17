# Retrieval evaluation: synthora-seed

5 judged questions. Labels: Draft labels by Claude (claude-opus-5-5) from titles and abstract snippets, 2026-11-16. Not yet reviewed by a domain expert..

## Question as written (baseline)

| Question | P@10 | R@10 | nDCG@10 | RR | Unjudged in top 10 |
|---|---|---|---|---|---|
| ml-cvd-risk | 0.500 | 1.000 | 0.936 | 1.000 | 1 |
| dl-diabetic-retinopathy | 0.900 | 1.000 | 0.914 | 1.000 | 0 |
| sglt2-heart-failure | 0.900 | 1.000 | 0.760 | 1.000 | 0 |
| llm-clinical-notes | 0.200 | 1.000 | 0.422 | 0.200 | 0 |
| exercise-depression-older | 0.800 | 1.000 | 0.918 | 1.000 | 0 |
| **Mean** | **0.660** | **1.000** | **0.790** | **0.840** | 1 |

_Set SYNTHORA_EVAL_KEY with --provider and --model to compare the Research Planner._
