PLEASE DONT MAKE THIS A VIBE CODED REPO

# **Synthora — Agentic Clinical Research Assistant**



Full project blueprint

Cloudflare deployment

Bring Your Own API Key (BYOK)



Synthora is meant to be a serious, production-oriented AI application that demonstrates applied agentic AI engineering.

The idea is to build something that a clinical researcher could genuinely use to accelerate literature reviews, compare research findings, investigate medical questions, and produce evidence-backed reports.

And I like your deployment requirement: **users bring their own API keys.** This means you don't pay for their LLM usage, users choose their preferred AI provider, and the platform can scale without you carrying the inference bill.

Let's design it properly.

# **1. Project vision**

[Transforming medical research with conversational AI | Google Cloud Blog](https://images.openai.com/static-rsc-4/1jNvwALcLYj4pkk3ftOQ-iNMcNC6xMoNydXflRAozsO3n9YlWSenA1tt7xln3h42M6DZGNm2YrRvQNzfMYrTf3pAV5Sfxt1rlxIXvTa7foW7H2TY5QyFIVyirok2kgO8qSHN_5-hF0gXIp7r2bP0ktinq6uFfjbbxUSxOun8XTA?purpose=inline)

[cloud.google.com](https://cloud.google.com/blog/products/ai-machine-learning/the-blueprint-giles-ai-transforming-medical-research-conversational-generative-ai?utm_source=chatgpt.com)

**Synthora** is an agentic research assistant that helps researchers move from a research question to a structured, evidence-backed research report.

Instead of simply asking an LLM a question and receiving an answer, Synthora coordinates multiple specialized agents that perform different research tasks.

### **Example scenario**

A researcher asks:

"Compare recent research on the effectiveness of machine learning models for predicting cardiovascular disease risk. What approaches perform best, and what are their limitations?"

Synthora will:

1. Understand and break down the research question.
2. Search scientific literature.
3. Retrieve relevant publications.
4. Extract research methods, datasets, findings, and limitations.
5. Compare the studies.
6. Identify conflicting findings and evidence gaps.
7. Generate a structured research report with citations.
8. Allow the researcher to ask follow-up questions.

The important distinction: Synthora is a research-support tool, not a diagnostic system or a replacement for clinical judgment.

# **2. Core objectives**

The application should accomplish six things:

| Objective              | Description                                |
| ---------------------- | ------------------------------------------ |
| Research discovery     | Find relevant scientific publications      |
| Information extraction | Extract structured information from papers |
| Evidence synthesis     | Compare findings across publications       |
| Research analysis      | Identify patterns, limitations, and gaps   |
| Citation management    | Connect claims to original publications    |
| Report generation      | Produce structured research reports        |

The system should never invent research papers, DOI numbers, statistics, or citations.

Every important research claim should be traceable to a source.

# **3. The agent architecture**

This is where the project becomes interesting from an AI engineering perspective.

Rather than building one enormous prompt, we'll implement a coordinated multi-agent architecture.

[Turning Research into an Automated Pipeline with Multi-Agent Workflows](https://images.openai.com/static-rsc-4/QZuKMij6dAcbW0TBUT6C8yqzw6R92K9la3bWzfIgb6RT3CnJAnjGflyfPu8TUmJjmv8eS8N_kQLsFtjQCuOCPJyF3gS5hD0KVKxM6QvJZCFZm5nnGvxaeC7M8VjRYEsKJuGVH56fmFqgHJasO01ACBqYE0IqvpobzZ3qcVaqomM?purpose=inline)

[linkedin.com](https://www.linkedin.com/pulse/turning-research-automated-pipeline-multi-agent-workflows-andrew-lee-ru5bc?utm_source=chatgpt.com)

## **The six specialized agents**

**1. Research Planner Agent**

Coordinator

**Responsibility:** Understands the research question and creates an execution plan.

Example tasks:

- Identify important research concepts.
- Generate search queries.
- Determine inclusion and exclusion criteria.
- Decide which agents need to run.

**2. Literature Search Agent**

**Responsibility:** Finds relevant scientific publications.

Example tasks:

- Search PubMed.
- Search Europe PMC.
- Retrieve metadata and abstracts.
- Rank publications by relevance.
- Deduplicate results.

**3. Paper Extraction Agent**

**Responsibility:** Extracts structured information from research papers.

Example fields:

- Research objective.
- Study design.
- Population and sample size.
- Methodology.
- Models and algorithms.
- Dataset.
- Results.
- Limitations.

**4. Evidence Analysis Agent**

**Responsibility:** Analyzes and compares extracted findings.

Example tasks:

- Compare methodologies.
- Identify similar and conflicting findings.
- Compare reported metrics.
- Identify limitations.
- Highlight research gaps.

**5. Citation Verification Agent**

**Responsibility:** Checks whether the generated report is supported by retrieved publications.

Example tasks:

- Verify DOI and PMID identifiers.
- Check whether cited papers exist.
- Ensure citations refer to the correct source.
- Flag claims without supporting evidence.

**6. Research Synthesis Agent**

**Responsibility:** Produces the final research report.

Report sections:

- Executive summary.
- Background.
- Research methodology.
- Literature findings.
- Comparative analysis.
- Limitations.
- Research gaps.
- References.

**Important engineering decision:** The agents should not all run independently without coordination. Use a central orchestrator to control their execution, share structured outputs, handle failures, and decide when human review is needed.

# **4. Technology stack**

I recommend a TypeScript + Python architecture, with Cloudflare handling the public application and infrastructure.

## **Recommended technology stack**

[Why Cloudflare’s Outage Should Terrify AI-First Startups | by Abhinav | Medium](https://images.openai.com/static-rsc-4/immaY2F7iGiXlnjl5opEhJn-dJ2vLPiGF__x0JKWnog4FoeS1o83qe18--VLoh0Ey30e7AmHN7px_TTSjjYVw49q-c6lcMvIJK7ie22GKE0E9Ugyd5NJelg84iuJRGOB6Dlehx8XinjoFXh1Pd5owFMUL2It4krbatEcv_jB2kU?purpose=inline)

**Cloudflare — Hosting and infrastructure**

- Cloudflare Pages or Workers Static Assets — frontend hosting.
- Cloudflare Workers — backend API.
- Cloudflare D1 — relational database.
- Cloudflare R2 — PDF and report storage.
- Cloudflare Queues or Workflows — background research tasks.
- Cloudflare Turnstile — bot protection.

  [Cognee - Open-Source Agent Memory Platform](https://images.openai.com/static-rsc-4/wL63mMHjP9A4nG7QHBfJUeUo29Z8_5vwHzEJEymfNWI92wcSfSDSK3DN1KAjBF_KzENTQBuV3lOp_Bv2N5i2LyVyNRI9nROlb71BDgT896s6U_MgivtiGv0HgtO85XYEOz2GSWE5NlbnVCiV7-B4wYrSpb_REXAGSUVIU9MrWjU?purpose=inline)

  **Agent orchestration**
- LangGraph — multi-agent workflows.
- Pydantic — structured output validation.
- Python — research processing and analysis.

  [黒いロゴデザインの有名企業&ブランド事例20選［2026年最新版］ ｜ ロゴデザイン制作をネットで依頼！ ロゴオンライン（法人対応）](https://images.openai.com/static-rsc-4/sEsUUG6UghuFvpzbA7mvaEWtmEYEFVVbtdgDQF-y_3ABkBoKx2lWapcUBwqNnYgV7DM65X00XYDIKAWCLPNernN7brTjfs1WxLdnz30SSFEt4Z2KqE0ky_KEqkmtYQOSHtVWJmvSgWiKJiiRfeRkajl3eZJydtRlk_A2VjwLDpM?purpose=inline)

  **LLM providers**
- OpenAI API.
- Anthropic API.
- Google Gemini API.

Users select their preferred provider and supply their own API key.

[US NLM PubMed Logo Vector Download | Logowik](https://images.openai.com/static-rsc-4/KhBCkK_cLi10Uz21C3F7iJuXH9OzxWZOTANj6g4mhOE8Swb65oMto6dvkGJNzRbnV8lVBm0Y2iu3_-e1m80ZxUAEIgHLbMO8yjOSuzQJm4U-Iww5QrCBKj7M7x2TgE16ALH6i85bH5ry-llbWwdlof82O12Uxr1dEd7tkxHM3Mw?purpose=inline)

**Scientific data sources**

- PubMed / NCBI E-utilities.
- Europe PMC.
- PubMed Central Open Access subset.
- Crossref for publication metadata.

  [Next.js Course – Build Full-Stack Apps with Next.js 13+ and TypeScript](https://images.openai.com/static-rsc-4/IdhY2tQOSYpXzIZwMMhqhfy55eL4zSSs_RyVPRU4l4JRlJmz0XGX0GaENbUe268sQHH_vTLAikJGjc67t6edzaQjvcR2aOyy24uzrEuj_1YVl6DkTeWYCv7scA4EU0MKb2kspDvrB0CNA8766gC_ZunHev6Iw8YnRkdAU7PN1S0?purpose=inline)

  **Frontend**
- React.
- TypeScript.
- Vite.
- Tailwind CSS.
- shadcn/ui.
- Recharts for research visualizations.

### **Why Cloudflare?**

Cloudflare gives you a relatively lightweight deployment architecture without needing to manage traditional servers.

Its Workers platform supports bindings for D1, R2, Queues, Durable Objects, and Workflows.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare Workers docs+1



One architectural detail: LangGraph is Python-oriented, so I would initially run it as a separate Python service. Cloudflare Workers will handle authentication, frontend requests, user API-key forwarding, and job coordination. You can later move the orchestration into a compatible TypeScript implementation if you want a fully Cloudflare-native architecture.

## **5. Bring Your Own API Key (BYOK)**

This is one of the most important parts of your project.

Core product requirement

The user should not need to pay you for AI inference. They connect their own provider account.

### **User experience**

[Qurt — Your AI coworker, powered by every model](https://images.openai.com/static-rsc-4/Y5j3EhIsjRXOJLi3fG_ekFn1EW1vS4swX4fBhc6PpaOymDvzLg9D_1-GUSKUXV8-qg-s3n7KjhNH71HJTA9ZATP5TWIkMd4B8hQoKaq2hNHmvenu2oSiKFQdMuQlxTDGdh_e7RG70Br1Y6N3zT1Gwocr61xdPSBxU9J-_FcDNP8?purpose=inline)

[qurt.ai](https://qurt.ai/?utm_source=chatgpt.com)

When a user first opens Synthora, they see:

**Connect your AI provider**

Choose the AI provider you want Synthora to use. You supply and pay for your own API usage.

AI provider

OpenAI

Anthropic

Google Gemini

API key

Show API key

Copy key (demo)

Illustrative interface only. This does not connect or save your API key.

Your key should never be stored in the application database.

The actual application should have a Connect and Verify button that tests the key with the selected provider.

### **How BYOK should work technically**

I'd use this flow:

**User enters API key**

Browser session

**Cloudflare Worker**

Receives key over HTTPS, validates request

**LLM Provider**

Uses the user's own API key

**Agent response**

Returned to Synthora

**Security requirements:**

1. Never save user API keys in D1, R2, KV, or application logs.
2. Never put API keys in URLs or query parameters.
3. Pass keys through HTTPS headers or protected request bodies.
4. Redact authorization headers from logs and error reports.
5. Never expose the key to another user or another research session.
6. Keep keys in browser memory for the session, unless the user explicitly opts into a carefully protected local persistence feature.
7. Provide a disconnect option that clears the key from the browser session.

For your first release, I'd avoid saving keys altogether. Users can enter their key when they start a session.

**Important distinction:** Cloudflare AI Gateway has a BYOK feature, but its documented BYOK mechanism stores provider keys for the gateway owner in Cloudflare Secrets Store. That's different from your requirement, where every individual user supplies their own key. You should implement per-request user-key forwarding instead.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare AI Gateway docs+1



### **Supported providers**

| Provider  | Models to consider                 |
| --------- | ---------------------------------- |
| OpenAI    | GPT-6 family, supported API models |
| Anthropic | Claude Sonnet family               |
| Google    | Gemini Pro family                  |

Keep the model list configurable because model availability and API names can change.

# **6. Research data sources**

You don't need to build your own scientific research database.

You can integrate existing research APIs.

[720px-US-NLM-PubMed-Logo | STM Publishing News](https://images.openai.com/static-rsc-4/MEaeZaM6WNu1tKGU_Inf4dOXWx97v5LoaXID3NH9vqNw45a5NEDDpKhhOGp50R_PgGf-OfvXRVUePNdTJ3RryxstsCvBQtXbkIYGW9xIUt1_Yn3QBPigcLHZoEqr0YVp2jFGJxu38hUDxNIWA8UJlF2dp0FahGUnZTtRU9S-FV0?purpose=inline)

**PubMed**

Your primary discovery source for biomedical literature. Use NCBI E-utilities to search and retrieve publication metadata and abstracts.

[NCBI E-utilities documentation](https://www.ncbi.nlm.nih.gov/books/NBK25501/?utm_source=chatgpt.com)

[Europe PMC (@EuropePMC_news) on X](https://images.openai.com/static-rsc-4/xFodAK2BnAwTSA4cdfgBgVGHbUWNGo1ImPXP0ANIJpF_fm0ZqyqqiphMEe4ENQj9Pg3EByaJeloGasGdsf3Mxxp90_DBC2WbxjV20sQ5-zPNxK-HkN28-s9eC3slpNT5nnVNPkW-pQduyyOEW3oh72hhae3iACoMl5GrFJp1Cxg?purpose=inline)

**Europe PMC**

Search millions of scientific publications, access metadata, abstracts, and eligible open-access full-text articles.

[Europe PMC REST API](https://dev.europepmc.org/RestfulWebService?utm_source=chatgpt.com)

[crossref.jpeg](https://images.openai.com/static-rsc-4/lx9178QPJ32v-hHlsd2Dp2GkWDLOcqpl1kqnQTg7DvHjh39RDL66VysQDr7SvI9QuWisIpSxoqU5Xj4Rtiw4HIjgp6uvku99UHS0nb43Y1tVEi1fI33oxnV4Jh2kFg2aa7zUH8fVXOqSp5HFprvCbRpd0PCJWW7vHUG1QfS-pjg?purpose=inline)

**Crossref**

Verify DOI metadata, publication titles, authors, journal names, and publication dates.

[Crossref API](https://api.crossref.org/?utm_source=chatgpt.com)

I'd use PubMed and Europe PMC as your primary search sources, and Crossref as a metadata verification layer.

Europe PMC exposes more than 33 million publications and provides access to millions of full-text articles, including open-access content.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://dev.europepmc.org\&sz=32)

dev.europepmc.org+1



Be careful with full-text retrieval: only download and process articles that are available for reuse under their applicable licenses. An abstract being publicly searchable does not mean the full paper is freely reusable.

# **7. End-to-end research workflow**

This is the actual process when a researcher submits a question.

Let's walk through a complete example.

**Example research session**

Illustrative

**Research question**

"What machine learning methods are being used to predict cardiovascular disease risk, and how do their performance metrics compare?"

1. **Question planning**

   Research Planner identifies the topic, relevant terminology, study types, and search strategy.
2. **Literature discovery**

   Search Agent queries PubMed and Europe PMC and retrieves 50 relevant publications, for example.
3. **Filtering and ranking**

   Remove duplicates, identify irrelevant papers, and rank publications against the research question.
4. **Paper extraction**

   Extract the methods, populations, datasets, sample sizes, results, and limitations.
5. **Evidence analysis**

   Compare models such as logistic regression, random forests, XGBoost, and neural networks.
6. **Citation verification**

   Verify source identifiers and ensure that claims are linked to supporting publications.
7. **Report generation**

   Produce a research report with citations, comparative tables, and identified evidence gaps.

**Final output**

Research report

- Executive summary
- Research methodology
- Literature review
- Comparison of findings
- Evidence limitations
- Research gaps
- References

### **A key design decision: not every agent needs an LLM**

You should avoid wasting the user's API credits.

For example:

| Task                   | Implementation                    |
| ---------------------- | --------------------------------- |
| Search PubMed          | Normal API call                   |
| Deduplicate papers     | Python/TypeScript logic           |
| Verify DOI             | Crossref API                      |
| Rank papers            | Hybrid keyword + semantic ranking |
| Extract findings       | LLM                               |
| Compare studies        | LLM                               |
| Validate output schema | Pydantic/Zod                      |
| Verify citations       | Deterministic checks + LLM        |
| Generate report        | LLM                               |

This is an important production engineering decision: use deterministic code where possible and LLMs where reasoning is valuable.

# **8. Application interface**

I would make Synthora look like a professional research SaaS platform, not a generic chatbot.

[DeepCura — The First Agent-Operated Clinical AI Platform | $129/mo](https://images.openai.com/static-rsc-4/qXimgM8MR3Qony_ecS4_g0hQV624WrONLqNQdJp-aLQikYk1AIjmnKqZuB18mygt_8QDObXmfGKxGz2A6m3BsvMPqsPgDguOZM2Yhz_Jj2-m2DoFx1B1PeoMmOvMMo-lzbw_yQebP_VJlNdkVC-sjoiZubYRnMVs2I01HR3RVoc?purpose=inline)

[Paperguide vs Google Scholar: #1 Google Scholar Alternative 2025](https://images.openai.com/static-rsc-4/sI2E5b8nZ7nVvsA2yTXjYD6uUoeUhQrnM94agZjX0455wAWSoVwR1rUpStDcr2sy8GL9tpoJVUwu0B_QZSbscoTkjcYJtyGSzkOZ7HAuPyy7s7u6elGbdSE8mIHiqFQS89RPJVkXD8PML1rS0_UIiKydO7IiiLXhLvHuwvPao6Y?purpose=inline)

[Living Scientific Paper | Devpost](https://images.openai.com/static-rsc-4/p7WJszASfENICWNZ9JmaPecuTU_K8INnpL53WNBHm0U75hWDzfTAv2Iovk77RiH3IvAk8pP_aUClyzbrZPTR2ThBsgmfNPFZmzGyY8_LLI7kz1ZPFCypyQBNov8v8uREMM-UYuLj8BFNV4ns-7GixoRON4lJY_J_2O_CVmZAh_k?purpose=inline)

13

### **Main pages**

| Page               | Functionality                                   |
| ------------------ | ----------------------------------------------- |
| Dashboard          | Recent research sessions and project statistics |
| New Research       | Submit a research question                      |
| Research Workspace | Live agent progress and research results        |
| Literature Library | Saved papers and abstracts                      |
| Comparison         | Compare papers side by side                     |
| Reports            | Generate and export reports                     |
| Settings           | API provider, key connection, preferences       |

### **Research workspace layout**

I would use three main sections:

**Synthora Research Workspace**

Example

RESEARCH QUESTION

**Machine learning approaches for cardiovascular risk prediction**

Agent execution

Research Planner

Completed

Literature Search

Completed

Paper Extraction

In progress

Evidence Analysis

Pending

Citation Verification

Pending

Research Synthesis

Pending

**Research findings**

# **50**

Papers discovered

# **32**

Papers selected

Illustrative workspace data, not actual research results.

The live progress should be driven by actual agent execution events, not hardcoded animations.

# **9. Database design**

Use Cloudflare D1 with SQLite.

I would start with these tables:

| Table             | Important fields                                 |
| ----------------- | ------------------------------------------------ |
| users             | id, email, created_at                            |
| research_projects | id, user_id, title, description                  |
| research_sessions | id, project_id, question, status                 |
| research_papers   | id, pmid, doi, title, abstract, publication_date |
| session_papers    | session_id, paper_id, relevance_score            |
| paper_extractions | paper_id, extraction_json, model_used            |
| agent_runs        | session_id, agent_name, status, output           |
| research_reports  | session_id, report_json, created_at              |
| feedback          | session_id, rating, comments                     |

For the first version, you can even make user accounts optional and use anonymous sessions with securely generated identifiers.

**Do not put API keys in any of these tables.**

Store only non-sensitive provider preferences and usage metadata where necessary.

## **10. Backend API design**

Your Cloudflare Worker should expose endpoints similar to these:

| Method | Endpoint                     | Purpose                 |
| ------ | ---------------------------- | ----------------------- |
| POST   | `/api/auth/register`         | Register user           |
| POST   | `/api/research`              | Create research session |
| GET    | `/api/research/:id`          | Get research session    |
| POST   | `/api/research/:id/run`      | Start agent workflow    |
| GET    | `/api/research/:id/events`   | Stream agent progress   |
| GET    | `/api/research/:id/papers`   | Retrieve papers         |
| GET    | `/api/research/:id/report`   | Retrieve report         |
| POST   | `/api/provider/verify`       | Verify user's API key   |
| POST   | `/api/research/:id/feedback` | Submit feedback         |

Use Server-Sent Events (SSE) for live updates in the research workspace.

Use Cloudflare Workflows for durable, multi-step execution, and Queues where you need asynchronous processing.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare Workers docs



# **11. Cloudflare deployment architecture**

Here is how I'd deploy the application.

[Making state easy with D1 GA, Hyperdrive, Queues and Workers Analytics Engine updates](https://images.openai.com/static-rsc-4/Aak_RptUbZyN1Qt9nJZ8NV3cyw2qBdfj4ZWfXBpDFXUhyyg2lLvVdqR4f-rJo__BsmAWcdDacOVVRLyy52FiIPZUdGvUOfddpPP2KE99BDbMSpEAjXDySPfWGL5yCRlOx2bfq2Ncx1-jzAAE5ZtqJ_-xbiPIwqp8sGM6-e1QiSQ?purpose=inline)

[blog.cloudflare.com](https://blog.cloudflare.com/making-full-stack-easier-d1-ga-hyperdrive-queues?utm_source=chatgpt.com)

**Synthora.com**

React + TypeScript frontend

**Cloudflare Workers**

API, authentication, provider adapters, orchestration

**D1**

Metadata and sessions

**R2**

PDFs and reports

**Workflows**

Agent execution

**Queues**

Background jobs

**External services**

OpenAI / Anthropic / Gemini + PubMed / Europe PMC / Crossref

My preference is to keep the initial application entirely on Cloudflare Workers using TypeScript for the orchestration layer. You can still use Python for model experiments, offline evaluation, and data analysis.

This avoids needing a permanently running Python server just to coordinate agents.

# **12. Research quality and evaluation**

This is one of the most important sections of the project.

A working agent is not necessarily a good agent.

You need to demonstrate that Synthora produces reliable, reproducible research outputs.

I'd build an evaluation framework with the following metrics:

| Metric                  | What it measures                                   |
| ----------------------- | -------------------------------------------------- |
| Retrieval Precision\@10 | How many of the top 10 papers are relevant         |
| Retrieval Recall\@10    | How many relevant papers were retrieved            |
| Citation Accuracy       | Whether cited publications actually support claims |
| Extraction Accuracy     | Whether extracted information matches the source   |
| Hallucination Rate      | Unsupported factual claims                         |
| Completeness            | Whether important research findings are captured   |
| Latency                 | Time required to complete research                 |
| Cost per Session        | LLM token usage and API cost                       |

### **Build a proper evaluation dataset**

Create 50–100 research questions with manually reviewed reference papers and expected findings.

For example:

- Cardiovascular disease prediction.
- Diabetes risk prediction.
- Cancer detection using machine learning.
- Medical image classification.
- Clinical NLP.
- Healthcare resource optimization.

Then evaluate different models and prompts against the same questions.

You could compare GPT, Claude, and Gemini using the same evaluation dataset.

This gives you an actual experimental research component instead of simply claiming that your application works.

# **13. Security and healthcare considerations**

Because Synthora works with healthcare research, security must be part of the architecture.

I'd establish these boundaries:

- No patient-identifiable information (PHI) in the initial release.
- No medical diagnosis or treatment recommendations.
- Only use legally accessible research publications.
- Cite sources for factual research claims.
- Require human review of generated findings.
- Enforce per-user session isolation.
- Apply request rate limits.
- Validate uploaded documents.
- Never execute instructions embedded in uploaded research papers.
- Never trust an LLM-generated DOI without verification.

Also, your use of an external LLM provider does not automatically make an application HIPAA-compliant. Avoid patient data unless you have completed the necessary security, contractual, and compliance work.

# **14. Suggested GitHub repository structure**

I'd organize the project like this:

```

Synthora/
│
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── pages/
│   │   │   ├── features/
│   │   │   │   ├── research/
│   │   │   │   ├── literature/
│   │   │   │   ├── reports/
│   │   │   │   └── settings/
│   │   │   └── lib/
│   │   └── package.json
│   │
│   └── worker/
│       ├── src/
│       │   ├── routes/
│       │   ├── agents/
│       │   ├── providers/
│       │   ├── research/
│       │   ├── workflows/
│       │   ├── security/
│       │   └── index.ts
│       └── wrangler.jsonc
│
├── packages/
│   ├── schemas/
│   ├── shared/
│   └── prompts/
│
├── research/
│   ├── evaluation/
│   ├── datasets/
│   └── experiments/
│
├── database/
│   ├── schema.sql
│   └── migrations/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── agents/
│   └── evaluation/
│
├── docs/
│   ├── architecture.md
│   ├── api.md
│   └── evaluation.md
│
├── .env.example
├── .gitignore
└── README.md

```

# **15. Development roadmap**

I would dedicate approximately eight weeks to building a polished first release.

## **8-week development plan**

1. **Week 1 — Foundation**
   - Initialize GitHub repository.
   - Create React frontend.
   - Configure Cloudflare Workers.
   - Set up D1 and authentication.
   - Design initial dashboard.
2. **Week 2 — BYOK infrastructure**
   - Implement provider selection.
   - Implement OpenAI, Anthropic, and Gemini adapters.
   - Add API-key verification.
   - Implement secure key handling.
   - Test provider failures and invalid credentials.
3. **Week 3 — Literature discovery**
   - Integrate PubMed.
   - Integrate Europe PMC.
   - Implement Crossref.
   - Build publication deduplication.
   - Implement relevance ranking.
4. **Week 4 — Agent orchestration**
   - Build Research Planner.
   - Build Literature Search Agent.
   - Build Paper Extraction Agent.
   - Implement structured outputs.
   - Add workflow state management.
5. **Week 5 — Research intelligence**
   - Build Evidence Analysis Agent.
   - Build Citation Verification Agent.
   - Build Research Synthesis Agent.
   - Implement evidence-backed reports.
6. **Week 6 — Research interface**
   - Build research workspace.
   - Add live agent progress.
   - Build paper comparison.
   - Add source citations.
   - Add PDF and Markdown report exports.
7. **Week 7 — Evaluation and testing**
   - Create evaluation dataset.
   - Measure retrieval quality.
   - Evaluate citation accuracy.
   - Test hallucination detection.
   - Compare multiple LLM providers.
8. **Week 8 — Deployment**
   - Deploy frontend and Workers.
   - Configure Cloudflare D1 and R2.
   - Configure custom domain.
   - Add monitoring and rate limits.
   - Conduct security testing.
   - Publish documentation and demo.

# **16. What the finished project should demonstrate**

When you're finished, I want you to be able to demonstrate these things:

**Synthora project deliverables**

0 of 10 completed

0%

A working online application hosted on Cloudflare

Multi-provider BYOK integration

Six specialized research agents

PubMed and Europe PMC integrations

Automated paper extraction and comparison

Evidence-backed research reports with citations

Live agent execution tracking

Evaluation framework with measurable metrics

Security and failure-handling tests

Technical architecture documentation and demo video

# **17. My recommendation for your technical direction**

I want you to think about this project in two dimensions.

[Building Enterprise-Grade Deep Research Agents Using Salesforce’s Enterprise Deep Research (EDR) Framework | by Tuhin Sharma | Jan, 2026 | Medium](https://images.openai.com/static-rsc-4/j7RQdvB4UmOPPhorrkOjqViXnTMwqmUO_nbKzAAYAnoHBxXvGQkcs4NL8II16MKROJkWuN6GzS0OeHWzBvD6Zl_q_4Ge6O1LAXnFGmIoFPHWe-QAzFtFhBIyrRivkVGophI-lqp_6Rts89DUsPFkhkvN74PAhioXspoHcrlp-O4?purpose=inline)

**AI Engineering**

- Agent orchestration
- RAG
- LLM evaluation
- Tool calling
- Structured outputs

[AI Cluster Solutions for Scalable Compute | Hypertec](https://images.openai.com/static-rsc-4/H7_-_NZfcDfoibCjkjJxCID-by5trqrUkgXMC0Xjv5V0ROz7srw2NBVClWIqvdKvunutKT-mlHJ2sf58ddJZWl9WYKTkB1EmZWeXqCam7Hybq7qQNx9o0GyNbxHeqedVzljaihgSkzV3XPUyAosSipnvzr3rHx2DVeFN4SgOtDs?purpose=inline)

**Systems Engineering**

- Distributed workflows
- API infrastructure
- GPU experimentation
- Cloud deployment
- Performance optimization


can i add nvidia openshell, is it free
Yes! And I actually think NVIDIA OpenShell would be a great addition to ClinAgent. It would make the project more interesting from an AI security and infrastructure engineering perspective.

OpenShell
1. Is NVIDIA OpenShell free?
Free and open source
NVIDIA OpenShell is released under the Apache License 2.0.

That means you can:

Use it in personal projects.

Use it commercially.

Modify its source code.

Integrate it into ClinAgent.

Deploy it without paying NVIDIA a software licensing fee.


Open, Secure Runtime for AI Agents
+1
You may still incur infrastructure costs for the machines running it.

Official resources:

NVIDIA OpenShell

OpenShell documentation

OpenShell license

2. What would OpenShell do in ClinAgent?
Remember, ClinAgent has six agents:

Research Planner

Literature Search

Paper Extraction

Evidence Analysis

Citation Verification

Research Synthesis

These agents may interact with external APIs, retrieve documents, process files, and execute tools.

OpenShell provides a security layer that controls what agents can access and do.

For example:

Agent

OpenShell security policy

Research Planner

Only access approved research tools

Literature Search

Access PubMed and Europe PMC

Paper Extraction

Read approved research documents

Evidence Analysis

Access extracted research data

Citation Verification

Access Crossref and publication metadata

Research Synthesis

Read validated findings and generate reports

OpenShell provides sandboxing, permission policies, network controls, credential brokering, and audit logs. 

Open, Secure Runtime for AI Agents

3. How I'd integrate it
ClinAgent Frontend

Cloudflare Pages

Cloudflare Workers

Authentication and API orchestration

OpenShell Gateway

Agent permissions and policy enforcement

Isolated Agent Sandboxes

Planner · Search · Extraction · Analysis · Verification · Synthesis

External Services

LLM providers · PubMed · Europe PMC · Crossref

Development: Your Windows laptop with Docker Desktop and WSL2, or an Ubuntu environment.
Best hosting options for OpenShell










1. Oracle Cloud Infrastructure (OCI)
My first choice — free tier
- Always Free Ampere ARM VM.
- Up to 4 ARM cores and 24 GB RAM equivalent if using the full monthly allowance.
- Linux hosting.
- Suitable for experimenting with OpenShell.


## **18. Useful technical documentation**

These are the official resources I'd use while building:

| Resource             | Documentation                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| Cloudflare Workers   | [Workers docs](https://developers.cloudflare.com/workers/?utm_source=chatgpt.com)                 |
| Cloudflare D1        | [D1 docs](https://developers.cloudflare.com/d1/?utm_source=chatgpt.com)                           |
| Cloudflare R2        | [R2 docs](https://developers.cloudflare.com/r2/?utm_source=chatgpt.com)                           |
| Cloudflare Workflows | [Workflows docs](https://developers.cloudflare.com/workflows/?utm_source=chatgpt.com)             |
| LangGraph            | [LangGraph docs](https://docs.langchain.com/oss/python/langgraph/overview?utm_source=chatgpt.com) |
| PubMed               | [NCBI API docs](https://www.ncbi.nlm.nih.gov/books/NBK25501/?utm_source=chatgpt.com)              |
| Europe PMC           | [Europe PMC docs](https://dev.europepmc.org/RestfulWebService?utm_source=chatgpt.com)             |

One implementation detail: NCBI recommends no more than three requests per second without an API key, or up to ten with a key by default. Build caching and request throttling into the literature-search service.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://eutilities.github.io\&sz=32)

NCBI E-Utilities+1



# **Final vision**

[Vera Health Launches Deep Research Mode: Systematic Reviews in Minutes | Blog de Vera Health](https://images.openai.com/static-rsc-4/F4id1pca2hcNFFP29Vzvu0BD-AjmrrWpVX8gQ1dmV_wPx3M4YSWWCdwhb0_mY8Tz3F5KTHaTtoMw7BfQ3AmJD2fOXE4u5c8lTrvwaAyvo66sYwOG03HPnwrgD8qKSqwBUldiCAD6SwUeF297_4pLghZnZGsPbxalriEOFBX4LS4?purpose=inline)

[verahealth.ai](https://www.verahealth.ai/es/blog/vera-health-launches-deep-research-mode?utm_source=chatgpt.com)

I would position Synthora as:

**Synthora — Research synthesis powered by AI. An Agentic AI Platform for Scientific Literature Discovery, Evidence Synthesis, and Clinical Research Intelligence.**

In one paragraph:

A multi-agent AI research platform that automates literature discovery, extracts structured findings, compares scientific evidence, and generates traceable research reports. It supports multiple LLM providers through a bring-your-own-key architecture, is deployed on Cloudflare, and includes an evaluation framework that measures retrieval quality, extraction accuracy, and citation reliability.

**One final recommendation:** Build the literature discovery, extraction, and evidence synthesis workflow first. Don't start by building six agents simultaneously. Get one complete research question flowing through the system, validate its results, and then expand the architecture.