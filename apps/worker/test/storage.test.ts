import { describe, expect, it } from "vitest";
import { SessionSummary, type ResearchPreviewResult } from "@synthora/schemas";
import { handleRequest, type Deps } from "../src/index.js";
import { hashToken, resolveOwner, SESSION_COOKIE } from "../src/storage/owner.js";
import { D1SessionStore, MAX_RESULT_BYTES, SessionTooLargeError } from "../src/storage/sessions.js";
import { testD1 } from "./d1-shim.js";
import { paper } from "./helpers.js";

const result = (title = "A report"): ResearchPreviewResult => ({
  query: "q",
  plan: { status: "fallback", reason: "disabled", queries: { pubmed: "q", europepmc: "q", ranking: "q" }, attempts: 0, usage: { inputTokens: 0, outputTokens: 0 } },
  search: { outcomes: [{ source: "pubmed", status: "ok", totalHits: 1, returned: 1 }], totalRetrieved: 1 },
  papers: [{ ...paper({ id: "pmid:1", pmid: "1" }), relevance: { score: 0.1, lexicalScore: 1, sourceRanks: { pubmed: 1 } } }],
  extractions: [],
  analysis: { status: "skipped", reason: "no_evidence" },
  verification: { papers: [], claims: { status: "skipped", reason: "no_claims" } },
  report: {
    status: "written",
    title,
    question: "q",
    generatedAt: "2026-11-16T00:00:00.000Z",
    sections: [],
    studies: [],
    references: [],
    rejected: [],
    markdown: "# A report\n",
    model: "m",
    promptVersion: "synthesis-v1",
    attempts: 1,
    usage: { inputTokens: 0, outputTokens: 0 },
  },
  usage: { inputTokens: 10, outputTokens: 5 },
});

let n = 0;
const store = () =>
  new D1SessionStore(testD1(), () => new Date(Date.UTC(2026, 10, 16, 0, 0, n)), () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);

const save = (s: D1SessionStore, owner: string, question = "Which ML models work?") =>
  s.save({ owner, question, provider: "anthropic", model: "claude-opus-5-5", durationMs: 61_234.5, result: result() });

describe("resolveOwner", () => {
  it("issues a random HttpOnly session cookie and stores only its hash", async () => {
    const owner = await resolveOwner(new Request("https://synthora.test/api/research"));
    expect(owner.setCookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000; Secure$`));
    const token = owner.setCookie!.split(";")[0]!.split("=")[1]!;
    expect(owner.id).toBe(await hashToken(token));
    expect(owner.id).not.toContain(token);
  });

  it("recognises a returning browser and omits Secure on plain http (local dev)", async () => {
    const first = await resolveOwner(new Request("http://localhost/api/research"));
    expect(first.setCookie).not.toContain("Secure");
    const cookie = first.setCookie!.split(";")[0]!;
    const again = await resolveOwner(new Request("http://localhost/api/research", { headers: { cookie: `theme=dark; ${cookie}` } }));
    expect(again).toEqual({ id: first.id });
  });

  it("replaces malformed tokens rather than trusting them", async () => {
    const owner = await resolveOwner(new Request("http://localhost/", { headers: { cookie: `${SESSION_COOKIE}=short` } }));
    expect(owner.setCookie).toBeDefined();
  });
});

describe("D1SessionStore", () => {
  it("saves, lists newest first, and reads back a validated result", async () => {
    const s = store();
    const first = await save(s, "alice", "First question");
    const second = await save(s, "alice", "Second question");

    const list = await s.list("alice");
    expect(list.map((x) => x.id)).toEqual([second, first]);
    expect(list[0]).toEqual({
      id: second,
      question: "Second question",
      provider: "anthropic",
      model: "claude-opus-5-5",
      title: "A report",
      paperCount: 1,
      durationMs: 61_235,
      createdAt: expect.stringMatching(/^2026-11-16T/),
    });
    for (const x of list) expect(SessionSummary.safeParse(x).success).toBe(true);

    const record = await s.get("alice", first);
    expect(record?.question).toBe("First question");
    expect(record?.result.report.status).toBe("written");
  });

  it("isolates owners: another browser cannot list, read or delete a session", async () => {
    const s = store();
    const id = await save(s, "alice");
    expect(await s.list("mallory")).toEqual([]);
    expect(await s.get("mallory", id)).toBeUndefined();
    expect(await s.delete("mallory", id)).toBe(false);
    expect(await s.get("alice", id)).toBeDefined();
  });

  it("deletes the owner's own session", async () => {
    const s = store();
    const id = await save(s, "alice");
    expect(await s.delete("alice", id)).toBe(true);
    expect(await s.list("alice")).toEqual([]);
  });

  it("refuses results that are invalid or too large to store", async () => {
    const s = store();
    await expect(s.save({ owner: "a", question: "q", provider: "openai", model: "m", durationMs: 1, result: { nonsense: true } as never })).rejects.toThrow();
    const huge = result();
    huge.papers[0]!.abstract = "x".repeat(MAX_RESULT_BYTES);
    await expect(s.save({ owner: "a", question: "q", provider: "openai", model: "m", durationMs: 1, result: huge })).rejects.toBeInstanceOf(SessionTooLargeError);
  });
});

describe("session routes", () => {
  const deps = (sessions?: D1SessionStore): Deps => ({
    literatureClients: [],
    createAdapter: () => {
      throw new Error("unused");
    },
    crossref: { work: async () => undefined },
    ...(sessions && { sessions }),
  });
  const call = (path: string, init: RequestInit = {}, d = deps(store())) => handleRequest(new Request(`http://localhost${path}`, init), d);

  it("lists, reads and deletes only the caller's sessions", async () => {
    const s = store();
    const d = deps(s);
    const first = await call("/api/research", {}, d);
    const cookie = first.headers.get("set-cookie")!.split(";")[0]!;
    const owner = await hashToken(cookie.split("=")[1]!);
    const id = await save(s, owner);
    const other = await save(s, "someone-else");

    const list = (await (await call("/api/research", { headers: { cookie } }, d)).json()) as { sessions: Array<{ id: string }> };
    expect(list.sessions.map((x) => x.id)).toEqual([id]);

    expect((await call(`/api/research/${id}`, { headers: { cookie } }, d)).status).toBe(200);
    expect((await call(`/api/research/${other}`, { headers: { cookie } }, d)).status).toBe(404);
    expect((await call(`/api/research/not-a-uuid`, { headers: { cookie } }, d)).status).toBe(404);
    expect((await call(`/api/research/%E0%A4%A`, { headers: { cookie } }, d)).status).toBe(404);

    expect((await call(`/api/research/${other}`, { method: "DELETE", headers: { cookie } }, d)).status).toBe(404);
    expect((await call(`/api/research/${id}`, { method: "DELETE", headers: { cookie } }, d)).status).toBe(204);
    expect((await call(`/api/research/${id}`, { headers: { cookie } }, d)).status).toBe(404);
  });

  it("reports 503 when no database is configured", async () => {
    expect((await call("/api/research", {}, deps())).status).toBe(503);
  });

  it("only sets a cookie on routes that need an owner", async () => {
    expect((await call("/api/health")).headers.get("set-cookie")).toBeNull();
    expect((await call("/api/research")).headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
  });

  it("answers wrong methods on known paths with 405 and the allowed methods", async () => {
    const res = await call("/api/research/00000000-0000-4000-8000-000000000001", { method: "PUT" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, DELETE");
  });
});
