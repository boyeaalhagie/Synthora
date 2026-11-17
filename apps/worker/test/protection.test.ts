import { describe, expect, it } from "vitest";
import { handleRequest, type Deps } from "../src/index.js";
import { checkProtection, clientKey, TURNSTILE_HEADER } from "../src/security/protection.js";
import { scriptedFetch } from "./helpers.js";

const KEY = "sk-test-0123456789abcdefghijklmnop";

/** A rate limiter that allows `limit` calls per key. */
function limiter(limit: number) {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const binding: RateLimit = {
    async limit({ key }) {
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= limit };
    },
  };
  return { binding, keys };
}

const req = (headers: Record<string, string> = {}) => new Request("https://synthora.test/api/provider/verify", { method: "POST", headers });

describe("clientKey", () => {
  it("uses Cloudflare's connecting IP, never the cookie", () => {
    expect(clientKey(req({ "cf-connecting-ip": "203.0.113.7", cookie: "synthora_sid=abc" }))).toBe("203.0.113.7");
    expect(clientKey(req())).toBe("local");
  });
});

describe("checkProtection", () => {
  it("allows everything when nothing is configured (local development)", async () => {
    expect(await checkProtection(req(), "verify", undefined)).toEqual({ ok: true });
  });

  it("rate-limits per action and per client", async () => {
    const l = limiter(2);
    const protection = { limiters: { verify: l.binding } };
    const a = req({ "cf-connecting-ip": "203.0.113.1" });
    expect((await checkProtection(a, "verify", protection)).ok).toBe(true);
    expect((await checkProtection(a, "verify", protection)).ok).toBe(true);
    expect(await checkProtection(a, "verify", protection)).toMatchObject({ ok: false, status: 429, retryAfter: 60 });
    // Another client is unaffected, and actions without a limiter are not limited.
    expect((await checkProtection(req({ "cf-connecting-ip": "203.0.113.2" }), "verify", protection)).ok).toBe(true);
    expect((await checkProtection(a, "research", protection)).ok).toBe(true);
    expect(l.keys).toEqual(["verify:203.0.113.1", "verify:203.0.113.1", "verify:203.0.113.1", "verify:203.0.113.2"]);
  });

  it("verifies Turnstile tokens server-side, bound to the action", async () => {
    const { fetch, calls } = scriptedFetch([Response.json({ success: true, action: "verify" })]);
    const ok = await checkProtection(req({ [TURNSTILE_HEADER]: "tok", "cf-connecting-ip": "203.0.113.9" }), "verify", { turnstile: { secret: "s3cret", fetch } });
    expect(ok).toEqual({ ok: true });
    const body = new URLSearchParams(String(calls[0]!.init?.body));
    expect(Object.fromEntries(body)).toEqual({ secret: "s3cret", response: "tok", remoteip: "203.0.113.9" });
  });

  it.each([
    ["no token", {}, []],
    ["a failed check", { [TURNSTILE_HEADER]: "tok" }, [Response.json({ success: false })]],
    ["a token issued for another action", { [TURNSTILE_HEADER]: "tok" }, [Response.json({ success: true, action: "research" })]],
    ["Turnstile being unreachable (fails closed)", { [TURNSTILE_HEADER]: "tok" }, [new TypeError("network")]],
  ] as const)("rejects %s", async (_label, headers, replies) => {
    const { fetch } = scriptedFetch([...replies]);
    expect(await checkProtection(req(headers), "verify", { turnstile: { secret: "s", fetch } })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("protected routes", () => {
  const deps = (protection: Deps["protection"], publicConfig: Deps["publicConfig"] = {}): Deps => ({
    literatureClients: [],
    createAdapter: (provider) => ({ provider, listModels: async () => [{ id: "m" }], generate: async () => Promise.reject(new Error("unused")) }),
    crossref: { work: async () => undefined },
    ...(protection && { protection }),
    publicConfig,
  });
  const verify = (d: Deps, headers: Record<string, string> = {}) =>
    handleRequest(
      new Request("https://synthora.test/api/provider/verify", {
        method: "POST",
        headers: { "content-type": "application/json", "x-provider-key": KEY, ...headers },
        body: JSON.stringify({ provider: "openai" }),
      }),
      d,
    );

  it("answers 429 with Retry-After once the verify limit is reached", async () => {
    const d = deps({ limiters: { verify: limiter(1).binding } });
    expect((await verify(d)).status).toBe(200);
    const limited = await verify(d);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  it("requires a Turnstile token for research runs when Turnstile is configured", async () => {
    const { fetch } = scriptedFetch([]);
    const res = await handleRequest(
      new Request("https://synthora.test/api/research/preview", {
        method: "POST",
        headers: { "content-type": "application/json", "x-provider-key": KEY },
        body: JSON.stringify({ query: "ml cvd", provider: "openai", model: "m" }),
      }),
      deps({ turnstile: { secret: "s", fetch } }),
    );
    expect(res.status).toBe(403);
  });

  it("publishes only the public Turnstile site key", async () => {
    const res = await handleRequest(new Request("https://synthora.test/api/config"), deps(undefined, { turnstileSiteKey: "0x4AAA" }));
    expect(await res.json()).toEqual({ turnstileSiteKey: "0x4AAA" });
  });

  it("marks API responses nosniff", async () => {
    const res = await handleRequest(new Request("https://synthora.test/api/health"), deps(undefined));
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
