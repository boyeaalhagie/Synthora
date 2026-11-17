import { LiteratureSearchRequest } from "@synthora/schemas";
import { MinIntervalLimiter, type FetchFn } from "./lib/http.js";
import { EuropePmcClient } from "./literature/europepmc.js";
import { PubMedClient } from "./literature/pubmed.js";
import { searchLiterature } from "./literature/search.js";
import type { LiteratureClient } from "./literature/types.js";

export interface Env {
  NCBI_EMAIL?: string;
  NCBI_API_KEY?: string;
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
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

export async function handleRequest(request: Request, env: Env, clients = literatureClients(env)): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === "/api/health") {
    return request.method === "GET" ? json({ status: "ok" }) : json({ error: "Method not allowed" }, 405);
  }

  // Provisional endpoint for the discovery slice. It will become an internal
  // step of the Literature Search agent behind /api/research/:id/run.
  if (pathname === "/api/literature/search") {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await readJson(request);
    if (!body.ok) return body.response;

    const parsed = LiteratureSearchRequest.safeParse(body.value);
    if (!parsed.success) {
      return json({ error: "Invalid request", issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) }, 400);
    }

    const result = await searchLiterature(parsed.data, clients);
    const allFailed = result.outcomes.every((o) => o.status === "error");
    return json(result, allFailed ? 502 : 200);
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      // Log the error type only; request bodies may later carry user API keys.
      console.error("Unhandled error", err instanceof Error ? err.name : typeof err);
      return json({ error: "Internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
