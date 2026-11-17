import {
  LiteratureSearchRequest,
  NDJSON,
  ResearchPreviewRequest,
  VerifyProviderRequest,
  type ProgressEvent,
  type ResearchPreviewResult,
  type VerifyProviderResult,
} from "@synthora/schemas";
import { checkProtection, type Protection, type ProtectedAction } from "./security/protection.js";
import { resolveOwner, type Owner } from "./storage/owner.js";
import { D1SessionStore, type SessionStore } from "./storage/sessions.js";
import { CrossrefClient } from "./literature/crossref.js";
import { MinIntervalLimiter, type FetchFn } from "./lib/http.js";
import { EuropePmcClient } from "./literature/europepmc.js";
import { PubMedClient } from "./literature/pubmed.js";
import { searchLiterature } from "./literature/search.js";
import type { LiteratureClient } from "./literature/types.js";
import { ApiKey, createAdapter, ProviderError, PROVIDER_KEY_HEADER } from "./providers/index.js";
import { runResearch, type PipelineDeps, type PipelineParams } from "./research/pipeline.js";

export interface Env {
  NCBI_EMAIL?: string;
  NCBI_API_KEY?: string;
  /** Operator contact for Crossref's polite pool. Optional. */
  CROSSREF_MAILTO?: string;
  /** Saved research sessions. Optional: without it, research still runs but is not saved. */
  DB?: D1Database;
  /** Rate limiters (Cloudflare ratelimits bindings). */
  VERIFY_LIMITER?: RateLimit;
  RESEARCH_LIMITER?: RateLimit;
  /** Turnstile bot protection. Both must be set to enable it; the site key is public, the secret is a secret. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
}

export type Deps = PipelineDeps & {
  sessions?: SessionStore;
  protection?: Protection;
  /** Public configuration the web app reads at startup. */
  publicConfig?: { turnstileSiteKey?: string };
};

const MAX_BODY_BYTES = 16 * 1024;

// NCBI allows 3 req/s without a key and 10 req/s with one. Limiters live at
// module scope so they are shared by all requests handled by this isolate.
let cachedClients: { keyed: boolean; clients: LiteratureClient[] } | undefined;

function literatureClients(env: Env): LiteratureClient[] {
  const keyed = Boolean(env.NCBI_API_KEY);
  if (cachedClients?.keyed === keyed) return cachedClients.clients;

  const fetchFn: FetchFn = (input, init) => fetch(input, init);
  const clients: LiteratureClient[] = [
    new PubMedClient(
      { tool: "synthora", email: env.NCBI_EMAIL || undefined, apiKey: env.NCBI_API_KEY || undefined },
      { fetch: fetchFn, limiter: new MinIntervalLimiter(keyed ? 110 : 350) },
    ),
    new EuropePmcClient({ fetch: fetchFn, limiter: new MinIntervalLimiter(100) }),
  ];
  cachedClients = { keyed, clients };
  return clients;
}

// Crossref asks clients to stay well under 50 requests/second.
const crossrefLimiter = new MinIntervalLimiter(100);

function defaultDeps(env: Env): Deps {
  return {
    literatureClients: literatureClients(env),
    createAdapter: (provider, key) => createAdapter(provider, key),
    crossref: new CrossrefClient(
      { mailto: env.CROSSREF_MAILTO || undefined },
      { fetch: (input, init) => fetch(input, init), limiter: crossrefLimiter },
    ),
    ...(env.DB && { sessions: new D1SessionStore(env.DB) }),
    protection: {
      limiters: {
        ...(env.VERIFY_LIMITER && { verify: env.VERIFY_LIMITER }),
        ...(env.RESEARCH_LIMITER && { research: env.RESEARCH_LIMITER }),
      },
      ...(env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY && { turnstile: { secret: env.TURNSTILE_SECRET, fetch: (input, init) => fetch(input, init) } }),
    },
    publicConfig: env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY ? { turnstileSiteKey: env.TURNSTILE_SITE_KEY } : {},
  };
}

/** Applies rate limits and the bot check for an action; returns the refusal response, if any. */
async function guard(request: Request, deps: Deps, action: ProtectedAction): Promise<Response | undefined> {
  const verdict = await checkProtection(request, action, deps.protection);
  if (verdict.ok) return undefined;
  return json({ error: verdict.error }, verdict.status, { ...noStoreHeaders, ...(verdict.retryAfter && { "retry-after": String(verdict.retryAfter) }) });
}

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const response = new Response(JSON.stringify(body), { status, headers });
  response.headers.set("content-type", "application/json; charset=utf-8");
  return response;
}

async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { ok: false, response: json({ error: "Content-Type must be application/json" }, 415) };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return { ok: false, response: json({ error: "Request body too large" }, 413) };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: json({ error: "Request body is not valid JSON" }, 400) };
  }
}

function invalidRequest(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): Response {
  return json(
    { error: "Invalid request", issues: issues.map((i) => ({ path: i.path.map(String), message: i.message })) },
    400,
  );
}

async function literatureSearch(request: Request, deps: Deps): Promise<Response> {
  const body = await readJson(request);
  if (!body.ok) return body.response;

  const parsed = LiteratureSearchRequest.safeParse(body.value);
  if (!parsed.success) return invalidRequest(parsed.error.issues);

  const result = await searchLiterature(parsed.data, deps.literatureClients);
  const allFailed = result.outcomes.every((o) => o.status === "error");
  return json(result, allFailed ? 502 : 200);
}

/**
 * Checks a user's key by listing the provider's models (no tokens spent) and
 * returns the models the key can use. The key arrives in a header, is used
 * for this one call, and is never stored, logged, or echoed back.
 */
async function verifyProvider(request: Request, deps: Deps): Promise<Response> {
  // Responses about a credential must never be cached by browsers or proxies.
  const noStore = { "cache-control": "no-store" };

  const key = ApiKey.fromRequest(request);
  if (!key) return json({ error: `Missing or malformed ${PROVIDER_KEY_HEADER} header` }, 400, noStore);

  const body = await readJson(request);
  if (!body.ok) return body.response;
  // Limits make this endpoint useless for bulk-testing stolen keys.
  const refused = await guard(request, deps, "verify");
  if (refused) return refused;
  const parsed = VerifyProviderRequest.safeParse(body.value);
  if (!parsed.success) return invalidRequest(parsed.error.issues);

  const { provider } = parsed.data;
  try {
    const models = await deps.createAdapter(provider, key).listModels();
    const result: VerifyProviderResult = { valid: true, provider, models };
    return json(result, 200, noStore);
  } catch (err) {
    const error = err instanceof ProviderError ? err : new ProviderError("unknown");
    const result: VerifyProviderResult = { valid: false, provider, error: { kind: error.kind, message: error.message } };
    // A rejected key is a successful verification with a negative answer;
    // only failures to get an answer at all are reported as 502.
    const status = error.kind === "unavailable" || error.kind === "unknown" ? 502 : 200;
    return json(result, status, noStore);
  }
}

/**
 * Runs the full research pipeline with the user's own key. It only runs
 * Synthora's own prompts, so it cannot be used as a general-purpose LLM proxy.
 * Completed results are saved for the requesting browser (never the key).
 */
async function researchPreview(request: Request, ctx: Context): Promise<Response> {
  const noStore = { "cache-control": "no-store" };

  const key = ApiKey.fromRequest(request);
  if (!key) return json({ error: `Missing or malformed ${PROVIDER_KEY_HEADER} header` }, 400, noStore);

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = ResearchPreviewRequest.safeParse(body.value);
  if (!parsed.success) return invalidRequest(parsed.error.issues);
  const refused = await guard(request, ctx.deps, "research");
  if (refused) return refused;

  const owner = (await ctx.owner()).id;
  if (request.headers.get("accept")?.includes(NDJSON)) return streamResearch(parsed.data, key, ctx.deps, owner);

  const started = Date.now();
  const outcome = await runResearch(parsed.data, key, ctx.deps, { emit: () => {}, isCancelled: () => false });
  if (!outcome.ok) return json({ error: outcome.error, ...(outcome.outcomes && { outcomes: outcome.outcomes }) }, outcome.status, noStore);
  const sessionId = await saveSession(ctx.deps, owner, parsed.data, outcome.result, Date.now() - started);
  return json(outcome.result, 200, { ...noStore, ...(sessionId && { "x-session-id": sessionId }) });
}

/** Saving is best-effort: a storage failure must never lose the user a result they have already paid for. */
async function saveSession(deps: Deps, owner: string, params: PipelineParams, result: ResearchPreviewResult, durationMs: number): Promise<string | undefined> {
  if (!deps.sessions) return undefined;
  // Runs that produced no verified data (e.g. the key was rejected) have nothing worth reopening.
  if (!result.extractions.some((e) => e.status === "extracted")) return undefined;
  try {
    return await deps.sessions.save({ owner, question: params.query, provider: params.provider, model: params.model, durationMs, result });
  } catch (err) {
    console.error("Saving research session failed", err instanceof Error ? err.name : typeof err);
    return undefined;
  }
}

/**
 * Streams progress events as NDJSON while the pipeline runs, ending with a
 * `result` or `error` event. If the client disconnects (writes start to
 * fail), the pipeline stops before its next model call so a cancelled run
 * does not keep spending the user's tokens.
 */
function streamResearch(params: PipelineParams, key: ApiKey, deps: Deps, owner: string): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let disconnected = false;

  const emit = (event: ProgressEvent) => {
    if (disconnected) return;
    writer.write(encoder.encode(`${JSON.stringify(event)}\n`)).catch(() => {
      disconnected = true;
    });
  };

  void (async () => {
    try {
      const started = Date.now();
      const outcome = await runResearch(params, key, deps, { emit, isCancelled: () => disconnected });
      if (!outcome.ok) {
        emit({ type: "error", message: outcome.error });
        return;
      }
      // Saved even if the client has gone: the tokens were spent, so the report should be there when they return.
      const sessionId = await saveSession(deps, owner, params, outcome.result, Date.now() - started);
      emit({ type: "result", result: outcome.result, ...(sessionId && { sessionId }) });
    } catch (err) {
      console.error("Research pipeline failed", err instanceof Error ? err.name : typeof err);
      emit({ type: "error", message: "Something went wrong while running this research." });
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, { headers: { "content-type": `${NDJSON}; charset=utf-8`, "cache-control": "no-store" } });
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStoreHeaders = { "cache-control": "no-store" };

function persistenceUnavailable(): Response {
  return json({ error: "Saved research is not available: no database is configured." }, 503, noStoreHeaders);
}

async function listSessions(_request: Request, ctx: Context): Promise<Response> {
  if (!ctx.deps.sessions) return persistenceUnavailable();
  return json({ sessions: await ctx.deps.sessions.list((await ctx.owner()).id) }, 200, noStoreHeaders);
}

async function getSession(_request: Request, ctx: Context, params: Record<string, string>): Promise<Response> {
  if (!ctx.deps.sessions) return persistenceUnavailable();
  const id = params.id ?? "";
  // Another browser's session is indistinguishable from one that does not exist.
  const record = SESSION_ID.test(id) ? await ctx.deps.sessions.get((await ctx.owner()).id, id) : undefined;
  return record ? json(record, 200, noStoreHeaders) : json({ error: "Not found" }, 404, noStoreHeaders);
}

async function deleteSession(_request: Request, ctx: Context, params: Record<string, string>): Promise<Response> {
  if (!ctx.deps.sessions) return persistenceUnavailable();
  const id = params.id ?? "";
  const deleted = SESSION_ID.test(id) && (await ctx.deps.sessions.delete((await ctx.owner()).id, id));
  return deleted ? new Response(null, { status: 204 }) : json({ error: "Not found" }, 404, noStoreHeaders);
}

/** Per-request context. The owner is resolved lazily, so routes that do not need it never set a cookie. */
interface Context {
  deps: Deps;
  owner: () => Promise<Owner>;
}

type Handler = (request: Request, ctx: Context, params: Record<string, string>) => Promise<Response>;

const ROUTES: Array<{ method: string; path: string; handler: Handler }> = [
  { method: "GET", path: "/api/health", handler: async () => json({ status: "ok" }) },
  { method: "GET", path: "/api/config", handler: async (_r, c) => json(c.deps.publicConfig ?? {}, 200, noStoreHeaders) },
  // Provisional: becomes an internal step of the Literature Search agent.
  { method: "POST", path: "/api/literature/search", handler: (r, c) => literatureSearch(r, c.deps) },
  { method: "POST", path: "/api/provider/verify", handler: (r, c) => verifyProvider(r, c.deps) },
  { method: "POST", path: "/api/research/preview", handler: researchPreview },
  { method: "GET", path: "/api/research", handler: listSessions },
  { method: "GET", path: "/api/research/:id", handler: getSession },
  { method: "DELETE", path: "/api/research/:id", handler: deleteSession },
];

/** Matches "/api/research/:id" style patterns; returns the named segments, or undefined. */
function match(pattern: string, pathname: string): Record<string, string> | undefined {
  const want = pattern.split("/");
  const got = pathname.split("/");
  if (want.length !== got.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const w = want[i]!;
    const g = got[i]!;
    if (w.startsWith(":")) {
      try {
        params[w.slice(1)] = decodeURIComponent(g);
      } catch {
        return undefined; // malformed %-encoding: treat as no match (404), not a server error
      }
    } else if (w !== g) return undefined;
  }
  return params;
}

export async function handleRequest(request: Request, deps: Deps): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const matches = ROUTES.flatMap((r) => {
    const params = match(r.path, pathname);
    return params ? [{ ...r, params }] : [];
  });
  if (matches.length === 0) return json({ error: "Not found" }, 404);
  const route = matches.find((r) => r.method === request.method);
  if (!route) return json({ error: "Method not allowed" }, 405, { allow: matches.map((r) => r.method).join(", ") });

  let owner: Promise<Owner> | undefined;
  const ctx: Context = { deps, owner: () => (owner ??= resolveOwner(request)) };
  const response = await route.handler(request, ctx, route.params);

  const cookie = owner && (await owner).setCookie;
  if (cookie) response.headers.append("set-cookie", cookie);
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, defaultDeps(env));
    } catch (err) {
      // Log the error type only. Requests can carry user API keys, so request
      // data and error messages are never logged.
      console.error("Unhandled error", err instanceof Error ? err.name : typeof err);
      return json({ error: "Internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
