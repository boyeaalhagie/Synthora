import { describe, expect, it } from "vitest";
import { fetchWithRetry, MinIntervalLimiter, UpstreamError } from "../src/lib/http.js";
import { scriptedFetch } from "./helpers.js";

const url = new URL("https://api.example.org/search?api_key=SECRET&q=x");
const retry = { retries: 2, baseDelayMs: 100, timeoutMs: 1000 };

function recordingSleep() {
  const delays: number[] = [];
  return { delays, sleep: async (ms: number) => void delays.push(ms) };
}

describe("fetchWithRetry", () => {
  it("returns the first successful response", async () => {
    const { fetch, calls } = scriptedFetch([new Response("ok")]);
    const res = await fetchWithRetry(url, {}, { fetch, retry });
    expect(await res.text()).toBe("ok");
    expect(calls).toHaveLength(1);
  });

  it("retries transient failures with exponential backoff", async () => {
    const { delays, sleep } = recordingSleep();
    const { fetch, calls } = scriptedFetch([
      new Response("", { status: 503 }),
      new TypeError("network down"),
      new Response("ok"),
    ]);
    await fetchWithRetry(url, {}, { fetch, sleep, retry });
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([100, 200]);
  });

  it("honours Retry-After, capped at 10 seconds", async () => {
    const { delays, sleep } = recordingSleep();
    const { fetch } = scriptedFetch([
      new Response("", { status: 429, headers: { "retry-after": "2" } }),
      new Response("", { status: 429, headers: { "retry-after": "3600" } }),
      new Response("ok"),
    ]);
    await fetchWithRetry(url, {}, { fetch, sleep, retry });
    expect(delays).toEqual([2000, 10_000]);
  });

  it("does not retry client errors", async () => {
    const { fetch, calls } = scriptedFetch([new Response("", { status: 400 })]);
    await expect(fetchWithRetry(url, {}, { fetch, retry })).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(1);
  });

  it("gives up after the retry budget and never leaks the query string", async () => {
    const { sleep } = recordingSleep();
    const { fetch, calls } = scriptedFetch([
      new Response("", { status: 500 }),
      new Response("", { status: 500 }),
      new Response("", { status: 500 }),
    ]);
    const error = await fetchWithRetry(url, {}, { fetch, sleep, retry }).catch((e: unknown) => e);
    expect(calls).toHaveLength(3);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as Error).message).toBe("api.example.org/search responded 500");
    expect((error as Error).message).not.toContain("SECRET");
  });

  it("reports timeouts distinctly", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const { fetch } = scriptedFetch([timeout]);
    await expect(fetchWithRetry(url, {}, { fetch, retry: { ...retry, retries: 0 } })).rejects.toThrow(
      "api.example.org/search timed out after 1000ms",
    );
  });
});

describe("MinIntervalLimiter", () => {
  it("spaces concurrent acquisitions by the interval", async () => {
    let now = 1000;
    const waits: number[] = [];
    const limiter = new MinIntervalLimiter(
      350,
      () => now,
      async (ms) => void waits.push(ms),
    );
    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);
    expect(waits).toEqual([350, 700]);

    now = 10_000; // long idle period: no wait
    await limiter.acquire();
    expect(waits).toEqual([350, 700]);
  });
});
