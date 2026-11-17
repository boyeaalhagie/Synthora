import { describe, expect, it } from "vitest";
import {
  ResearchPreviewResult,
  type LiteratureSearchResult,
  type LiteratureSource,
  type LlmProvider,
  type Paper,
  type VerifyProviderResult,
} from "@synthora/schemas";
import { handleRequest, type Deps } from "../src/index.js";
import { UpstreamError } from "../src/lib/http.js";
import type { LiteratureClient } from "../src/literature/types.js";
import { SYSTEM_PROMPT as PLANNER } from "../src/agents/planner/agent.js";
import type { ApiKey } from "../src/providers/api-key.js";
import { ProviderError, type ProviderAdapter } from "../src/providers/types.js";
import { D1SessionStore } from "../src/storage/sessions.js";
import { testD1 } from "./d1-shim.js";
import { paper } from "./helpers.js";

const KEY = "sk-test-0123456789abcdefghijklmnop";

function stubClient(source: LiteratureSource, outcome: Paper[] | Error): LiteratureClient {
  return {
    source,
    async search() {
      if (outcome instanceof Error) throw outcome;
      return { totalHits: outcome.length, papers: outcome };
    },
  };
}

function fakeAdapters(behaviour: Error | "ok") {
  const seen: Array<{ provider: LlmProvider; key: ApiKey }> = [];
  const createAdapter = (provider: LlmProvider, key: ApiKey): ProviderAdapter => {
    seen.push({ provider, key });
    return {
      provider,
      async listModels() {
        if (behaviour instanceof Error) throw behaviour;
        return [{ id: "model-a", displayName: "Model A" }];
      },
      async generate() {
        throw new Error("not used");
      },
    };
  };
  return { createAdapter, seen };
}

function deps(overrides: Partial<Deps> = {}): Deps {
  return {
    literatureClients: [stubClient("pubmed", [paper({ id: "pmid:1", pmid: "1" })]), stubClient("europepmc", [])],
    createAdapter: fakeAdapters("ok").createAdapter,
    crossref: { work: async () => undefined },
    ...overrides,
  };
}

function post(path: string, body: string, headers: Record<string, string> = {}, d: Deps = deps()) {
  return handleRequest(
    new Request(`https://synthora.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    }),
    d,
  );
}

describe("routing", () => {
  it("handles health, unknown routes and wrong methods", async () => {
    const call = (path: string, method = "GET") => handleRequest(new Request(`https://synthora.test${path}`, { method }), deps());
    expect((await call("/api/health")).status).toBe(200);
    expect((await call("/nope")).status).toBe(404);
    const wrongMethod = await call("/api/literature/search");
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST");
  });
});

describe("POST /api/literature/search", () => {
  const search = (body: string, contentType = "application/json") =>
    post("/api/literature/search", body, { "content-type": contentType });

  it("applies defaults and returns results", async () => {
    const res = await search(JSON.stringify({ query: "ml cvd" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as LiteratureSearchResult;
    expect(body.papers.map((p) => p.id)).toEqual(["pmid:1"]);
    expect(body.outcomes.map((o) => o.source)).toEqual(["pubmed", "europepmc"]);
  });

  it("rejects invalid input with field-level issues", async () => {
    const res = await search(JSON.stringify({ query: "x", limitPerSource: 1000 }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: Array<{ path: string[] }> };
    expect(body.issues.map((i) => i.path[0]).sort()).toEqual(["limitPerSource", "query"]);
  });

  it("rejects malformed JSON, wrong content types and oversized bodies", async () => {
    expect((await search("{")).status).toBe(400);
    expect((await search("{}", "text/plain")).status).toBe(415);
    expect((await search(JSON.stringify({ query: "a".repeat(20_000) }))).status).toBe(413);
  });

  it("returns 502 when every source failed", async () => {
    const res = await post(
      "/api/literature/search",
      JSON.stringify({ query: "ml cvd", sources: ["pubmed"] }),
      {},
      deps({ literatureClients: [stubClient("pubmed", new UpstreamError("down"))] }),
    );
    expect(res.status).toBe(502);
  });
});

describe("POST /api/provider/verify", () => {
  const verify = (body: unknown, headers: Record<string, string> = { "x-provider-key": KEY }, d = deps()) =>
    post("/api/provider/verify", JSON.stringify(body), headers, d);

  it("verifies the key from the header and returns the provider's models", async () => {
    const adapters = fakeAdapters("ok");
    const res = await verify({ provider: "anthropic" }, undefined, deps({ createAdapter: adapters.createAdapter }));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      valid: true,
      provider: "anthropic",
      models: [{ id: "model-a", displayName: "Model A" }],
    } satisfies VerifyProviderResult);
    expect(adapters.seen.map((s) => [s.provider, s.key.reveal()])).toEqual([["anthropic", KEY]]);
  });

  it("never echoes the key in the response", async () => {
    for (const behaviour of ["ok", new ProviderError("invalid_key", 401), new Error(KEY)] as const) {
      const res = await verify({ provider: "openai" }, undefined, deps({ createAdapter: fakeAdapters(behaviour).createAdapter }));
      expect(await res.text()).not.toContain(KEY);
    }
  });

  it("reports a rejected key as a negative answer, not a server error", async () => {
    const d = deps({ createAdapter: fakeAdapters(new ProviderError("invalid_key", 401)).createAdapter });
    const res = await verify({ provider: "gemini" }, undefined, d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      valid: false,
      provider: "gemini",
      error: { kind: "invalid_key", message: "The provider rejected this API key." },
    });
  });

  it("returns 502 when the provider could not be reached or failed unexpectedly", async () => {
    for (const failure of [new ProviderError("unavailable", 503), new Error("boom")]) {
      const res = await verify({ provider: "openai" }, undefined, deps({ createAdapter: fakeAdapters(failure).createAdapter }));
      expect(res.status).toBe(502);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("requires a well-formed key header and never reads the key from the body", async () => {
    const adapters = fakeAdapters("ok");
    const d = deps({ createAdapter: adapters.createAdapter });
    expect((await verify({ provider: "openai", key: KEY }, {}, d)).status).toBe(400);
    expect((await verify({ provider: "openai" }, { "x-provider-key": "short" }, d)).status).toBe(400);
    expect(adapters.seen).toEqual([]);
  });

  it("rejects unknown providers", async () => {
    const res = await verify({ provider: "acme" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/research/preview", () => {
  const plan = { concepts: [{ name: "ml", terms: ["machine learning"] }], yearFrom: null, yearTo: null };
  const extraction = JSON.stringify({
    objective: null,
    studyDesign: null,
    population: null,
    sampleSize: null,
    dataset: null,
    methods: [],
    findings: [],
    limitations: [],
  });

  function extractingAdapters() {
    const prompts: string[] = [];
    const createAdapter = (provider: LlmProvider): ProviderAdapter => ({
      provider,
      async listModels() {
        return [];
      },
      async generate(request) {
        if (request.system === PLANNER) {
          return { text: JSON.stringify(plan), stopReason: "end", model: request.model, usage: { inputTokens: 1, outputTokens: 1 } };
        }
        prompts.push(request.prompt);
        return { text: extraction, stopReason: "end", model: request.model, usage: { inputTokens: 10, outputTokens: 5 } };
      },
    });
    return { createAdapter, prompts };
  }

  const literature = [
    stubClient("pubmed", [
      paper({ id: "pmid:1", pmid: "1", title: "Has abstract one", abstract: "First abstract text." }),
      paper({ id: "pmid:2", pmid: "2", title: "No abstract" }),
      paper({ id: "pmid:3", pmid: "3", title: "Has abstract two", abstract: "Second abstract text." }),
      paper({ id: "pmid:4", pmid: "4", title: "Has abstract three", abstract: "Third abstract text." }),
    ]),
    stubClient("europepmc", []),
  ];

  const preview = (body: unknown, headers: Record<string, string>, d: Deps) =>
    post("/api/research/preview", JSON.stringify(body), headers, d);

  it("extracts the top-ranked papers that have abstracts and totals usage", async () => {
    const adapters = extractingAdapters();
    const res = await preview(
      { query: "ml cvd", provider: "openai", model: "gpt-test", topN: 2 },
      { "x-provider-key": KEY },
      deps({ literatureClients: literature, createAdapter: adapters.createAdapter }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as ResearchPreviewResult;
    expect(ResearchPreviewResult.safeParse(body).success).toBe(true);
    expect(body.papers.map((p) => p.id)).toEqual(["pmid:1", "pmid:3"]);
    expect(body.extractions.map((e) => [e.paperId, e.status])).toEqual([
      ["pmid:1", "extracted"],
      ["pmid:3", "extracted"],
    ]);
    expect(body.usage).toEqual({ inputTokens: 21, outputTokens: 11 });
    expect(body.plan.status).toBe("planned");
    // The stub extractions contain no evidence, so analysis and claim review are skipped without model calls.
    expect(body.analysis).toEqual({ status: "skipped", reason: "no_evidence" });
    expect(body.verification.claims).toEqual({ status: "skipped", reason: "no_claims" });
    expect(body.report).toEqual({ status: "skipped", reason: "no_analysis" });
    // Record checks still run for every selected paper (the stub papers have no DOI).
    expect(body.verification.papers.map((c) => [c.paperId, c.crossref])).toEqual([
      ["pmid:1", "no_doi"],
      ["pmid:3", "no_doi"],
    ]);
    expect(adapters.prompts).toHaveLength(2);
  });

  it("saves runs that extracted papers, but not runs that produced no verified data", async () => {
    const sessions = new D1SessionStore(testD1());
    const res = await preview(
      { query: "ml cvd", provider: "openai", model: "gpt-test", topN: 2 },
      { "x-provider-key": KEY },
      deps({ literatureClients: literature, createAdapter: extractingAdapters().createAdapter, sessions }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-session-id")).toMatch(/^[0-9a-f-]{36}$/);

    // Every paper fails (e.g. a rejected key): nothing is saved.
    const failing = await preview(
      { query: "ml cvd", provider: "openai", model: "gpt-test", topN: 2 },
      { "x-provider-key": KEY },
      deps({
        literatureClients: literature,
        createAdapter: (provider) => ({
          provider,
          listModels: async () => [],
          generate: async () => {
            throw new ProviderError("invalid_key", 401);
          },
        }),
        sessions,
      }),
    );
    expect(failing.headers.get("x-session-id")).toBeNull();
  });

  it("requires a provider key and a model", async () => {
    const d = deps({ literatureClients: literature, createAdapter: extractingAdapters().createAdapter });
    expect((await preview({ query: "ml cvd", provider: "openai", model: "m" }, {}, d)).status).toBe(400);
    expect((await preview({ query: "ml cvd", provider: "openai" }, { "x-provider-key": KEY }, d)).status).toBe(400);
  });

  it("returns 502 without extracting anything when every literature source failed", async () => {
    const adapters = extractingAdapters();
    const res = await preview(
      { query: "ml cvd", provider: "openai", model: "m" },
      { "x-provider-key": KEY },
      deps({
        literatureClients: [stubClient("pubmed", new UpstreamError("down")), stubClient("europepmc", new UpstreamError("down"))],
        createAdapter: adapters.createAdapter,
      }),
    );
    expect(res.status).toBe(502);
    expect(adapters.prompts).toEqual([]);
  });
});
