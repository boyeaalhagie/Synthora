import { describe, expect, it } from "vitest";
import type { LiteratureSearchResult, LiteratureSource, LlmProvider, Paper, VerifyProviderResult } from "@synthora/schemas";
import { handleRequest, type Deps } from "../src/index.js";
import { UpstreamError } from "../src/lib/http.js";
import type { LiteratureClient } from "../src/literature/types.js";
import type { ApiKey } from "../src/providers/api-key.js";
import { ProviderError, type ProviderAdapter } from "../src/providers/types.js";
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
