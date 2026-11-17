import { LiteratureSearchRequest, VerifyProviderRequest, type VerifyProviderResult } from "@synthora/schemas";
import { MinIntervalLimiter, type FetchFn } from "./lib/http.js";
import { EuropePmcClient } from "./literature/europepmc.js";
import { PubMedClient } from "./literature/pubmed.js";
import { searchLiterature } from "./literature/search.js";
import type { LiteratureClient } from "./literature/types.js";
import { ApiKey, createAdapter, ProviderError, PROVIDER_KEY_HEADER, type AdapterFactory } from "./providers/index.js";

export interface Env {
  NCBI_EMAIL?: string;
  NCBI_API_KEY?: string;
}

export interface Deps {
  literatureClients: readonly LiteratureClient[];
  createAdapter: AdapterFactory;
}

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

function defaultDeps(env: Env): Deps {
  return { literatureClients: literatureClients(env), createAdapter: (provider, key) => createAdapter(provider, key) };
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

const ROUTES: Record<string, { method: string; handler: (request: Request, deps: Deps) => Promise<Response> }> = {
  "/api/health": { method: "GET", handler: async () => json({ status: "ok" }) },
  // Provisional: becomes an internal step of the Literature Search agent.
  "/api/literature/search": { method: "POST", handler: literatureSearch },
  "/api/provider/verify": { method: "POST", handler: verifyProvider },
};

export async function handleRequest(request: Request, deps: Deps): Promise<Response> {
  const route = ROUTES[new URL(request.url).pathname];
  if (!route) return json({ error: "Not found" }, 404);
  if (request.method !== route.method) return json({ error: "Method not allowed" }, 405, { allow: route.method });
  return route.handler(request, deps);
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
