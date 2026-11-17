import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { AnthropicAdapter } from "../src/providers/anthropic.js";
import { ApiKey } from "../src/providers/api-key.js";
import { GeminiAdapter } from "../src/providers/gemini.js";
import { OpenAiAdapter } from "../src/providers/openai.js";
import { ProviderError, type ProviderAdapter } from "../src/providers/types.js";
import { scriptedFetch, type RecordedCall } from "./helpers.js";

const SECRET = "sk-test-0123456789abcdefghijklmnop";
const key = ApiKey.parse(SECRET)!;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function bodyOf(call: RecordedCall): Record<string, unknown> {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

/**
 * The invariant that matters: the key travels in a header and never in the
 * URL (where it would land in access logs). Which header is the SDK's choice
 * and changes between versions, so it is not pinned here.
 */
function expectKeyOnlyInHeaders(calls: RecordedCall[]) {
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(call.url.href).not.toContain(SECRET);
    expect([...call.headers.values()].some((v) => v.includes(SECRET))).toBe(true);
  }
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ProviderError);
  // Messages are Synthora's own and never echo provider text (which can include the key).
  expect((err as Error).message).not.toContain("sk-");
  return (err as ProviderError).kind;
}

describe("ApiKey", () => {
  it("never exposes the key through implicit conversion", () => {
    expect(String(key)).toBe("[REDACTED]");
    expect(`${key}`).toBe("[REDACTED]");
    expect(JSON.stringify({ key })).toBe('{"key":"[REDACTED]"}');
    expect(inspect({ key })).not.toContain(SECRET);
    expect(key.reveal()).toBe(SECRET);
  });

  it.each([
    ["missing", null],
    ["too short", "sk-short"],
    ["whitespace inside", "sk-test 0123456789abcdefghij"],
    ["non-ASCII", "sk-test-0123456789abcdéfghij"],
    ["too long", "x".repeat(513)],
  ])("rejects %s keys", (_label, raw) => {
    expect(ApiKey.parse(raw)).toBeUndefined();
  });

  it("trims surrounding whitespace", () => {
    expect(ApiKey.parse(`  ${SECRET}\n`)?.reveal()).toBe(SECRET);
  });
});

describe("AnthropicAdapter", () => {
  const message = (overrides: Record<string, unknown> = {}) =>
    json({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 34 },
      ...overrides,
    });

  it("lists models with the key in a header", async () => {
    const { fetch, calls } = scriptedFetch([
      json({
        data: [{ type: "model", id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-01-01T00:00:00Z" }],
        has_more: false,
        first_id: "claude-opus-5-5",
        last_id: "claude-opus-5-5",
      }),
    ]);
    const models = await new AnthropicAdapter(key, { fetch }).listModels();
    expect(models).toEqual([{ id: "claude-opus-5-5", displayName: "Claude Opus 5.5" }]);
    expect(calls[0]!.url.pathname).toBe("/v1/models");
    expectKeyOnlyInHeaders(calls);
    expect(calls[0]!.headers.get("anthropic-version")).toBeTruthy();
  });

  it("generates text and enables refusal fallbacks on supported models", async () => {
    const { fetch, calls } = scriptedFetch([message()]);
    const result = await new AnthropicAdapter(key, { fetch }).generate({
      model: "claude-opus-5-5",
      system: "Be precise.",
      prompt: "Say hello",
      maxOutputTokens: 1000,
    });

    expect(result).toEqual({
      text: "Hello world",
      stopReason: "end",
      model: "claude-opus-5-5",
      usage: { inputTokens: 12, outputTokens: 34 },
    });
    expect(bodyOf(calls[0]!)).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 1000,
      system: "Be precise.",
      messages: [{ role: "user", content: "Say hello" }],
      fallbacks: "default",
    });
    expect(calls[0]!.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expectKeyOnlyInHeaders(calls);
  });

  it("omits fallbacks for models that do not support them", async () => {
    const { fetch, calls } = scriptedFetch([message({ model: "claude-haiku-5-5" })]);
    await new AnthropicAdapter(key, { fetch }).generate({ model: "claude-haiku-5-5", prompt: "hi", maxOutputTokens: 10 });
    expect(bodyOf(calls[0]!)).not.toHaveProperty("fallbacks");
    expect(calls[0]!.headers.get("anthropic-beta")).toBeNull();
  });

  it.each([
    ["max_tokens", "max_tokens"],
    ["refusal", "refusal"],
    ["pause_turn", "other"],
  ])("maps stop_reason %s to %s", async (raw, expected) => {
    const { fetch } = scriptedFetch([message({ stop_reason: raw })]);
    const result = await new AnthropicAdapter(key, { fetch }).generate({ model: "claude-opus-5-5", prompt: "x", maxOutputTokens: 10 });
    expect(result.stopReason).toBe(expected);
  });

  it.each([
    [401, "invalid_key"],
    [403, "permission_denied"],
    [404, "model_not_found"],
    [400, "bad_request"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    const { fetch } = scriptedFetch([
      json({ type: "error", error: { type: "error", message: `bad key ${SECRET.slice(0, 8)}` } }, status),
    ]);
    expect(await kindOf(new AnthropicAdapter(key, { fetch }).listModels())).toBe(kind);
  });

  it("retries rate limits and then reports them", async () => {
    const limited = () => json({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }, 429, { "retry-after-ms": "1" });
    const { fetch, calls } = scriptedFetch([limited, limited, limited]);
    expect(await kindOf(new AnthropicAdapter(key, { fetch }).listModels())).toBe("rate_limited");
    expect(calls).toHaveLength(3);
  });
});

describe("OpenAiAdapter", () => {
  const response = (overrides: Record<string, unknown> = {}) =>
    json({
      id: "resp_1",
      object: "response",
      created_at: 1,
      status: "completed",
      model: "gpt-test",
      output: [
        {
          type: "message",
          id: "msg_1",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: "Hello", annotations: [] }],
        },
      ],
      incomplete_details: null,
      usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 },
      ...overrides,
    });

  it("lists models sorted by id, with the key in a header", async () => {
    const { fetch, calls } = scriptedFetch([
      json({ object: "list", data: [{ id: "gpt-b", object: "model" }, { id: "gpt-a", object: "model" }] }),
    ]);
    expect(await new OpenAiAdapter(key, { fetch }).listModels()).toEqual([{ id: "gpt-a" }, { id: "gpt-b" }]);
    expectKeyOnlyInHeaders(calls);
  });

  it("generates via the Responses API without storing the response", async () => {
    const { fetch, calls } = scriptedFetch([response()]);
    const result = await new OpenAiAdapter(key, { fetch }).generate({
      model: "gpt-test",
      system: "Be precise.",
      prompt: "Say hello",
      maxOutputTokens: 100,
    });
    expect(result).toEqual({ text: "Hello", stopReason: "end", model: "gpt-test", usage: { inputTokens: 5, outputTokens: 7 } });
    expect(calls[0]!.url.pathname).toBe("/v1/responses");
    expect(bodyOf(calls[0]!)).toEqual({
      model: "gpt-test",
      instructions: "Be precise.",
      input: "Say hello",
      max_output_tokens: 100,
      store: false,
    });
  });

  it("detects truncation and refusals", async () => {
    const truncated = scriptedFetch([response({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })]);
    expect((await new OpenAiAdapter(key, { fetch: truncated.fetch }).generate({ model: "m", prompt: "p", maxOutputTokens: 1 })).stopReason).toBe(
      "max_tokens",
    );

    const refused = scriptedFetch([
      response({
        output: [
          { type: "message", id: "m", status: "completed", role: "assistant", content: [{ type: "refusal", refusal: "No." }] },
        ],
      }),
    ]);
    expect((await new OpenAiAdapter(key, { fetch: refused.fetch }).generate({ model: "m", prompt: "p", maxOutputTokens: 1 })).stopReason).toBe(
      "refusal",
    );
  });

  it("maps an invalid key without echoing the provider's message", async () => {
    const { fetch } = scriptedFetch([
      json({ error: { message: `Incorrect API key provided: ${SECRET.slice(0, 10)}***`, type: "invalid_request_error", code: "invalid_api_key" } }, 401),
    ]);
    expect(await kindOf(new OpenAiAdapter(key, { fetch }).listModels())).toBe("invalid_key");
  });
});

describe("GeminiAdapter", () => {
  it("lists only models that support generateContent, with the key in a header", async () => {
    const { fetch, calls } = scriptedFetch([
      json({
        models: [
          { name: "models/gemini-test-pro", displayName: "Gemini Test Pro", supportedGenerationMethods: ["generateContent", "countTokens"] },
          { name: "models/text-embedding-test", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
        ],
      }),
    ]);
    expect(await new GeminiAdapter(key, { fetch }).listModels()).toEqual([{ id: "gemini-test-pro", displayName: "Gemini Test Pro" }]);
    expectKeyOnlyInHeaders(calls);
    expect(calls[0]!.url.searchParams.has("key")).toBe(false);
  });

  it("treats a 400 while listing models as an invalid key", async () => {
    const { fetch } = scriptedFetch([
      json({ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }, 400),
    ]);
    expect(await kindOf(new GeminiAdapter(key, { fetch }).listModels())).toBe("invalid_key");
  });

  it("generates text and counts thinking tokens as output", async () => {
    const { fetch, calls } = scriptedFetch([
      json({
        candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, thoughtsTokenCount: 10 },
        modelVersion: "gemini-test-pro-001",
      }),
    ]);
    const result = await new GeminiAdapter(key, { fetch }).generate({
      model: "gemini-test-pro",
      system: "Be precise.",
      prompt: "Say hello",
      maxOutputTokens: 50,
    });
    expect(result).toEqual({ text: "Hello", stopReason: "end", model: "gemini-test-pro-001", usage: { inputTokens: 3, outputTokens: 14 } });
    expect(calls[0]!.url.pathname).toMatch(/models\/gemini-test-pro:generateContent$/);
    expect(bodyOf(calls[0]!)).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "Say hello" }] }],
      systemInstruction: { parts: [{ text: "Be precise." }] },
      generationConfig: { maxOutputTokens: 50 },
    });
    expectKeyOnlyInHeaders(calls);
  });

  it.each([
    [{ candidates: [{ content: { role: "model", parts: [] }, finishReason: "SAFETY" }] }, "refusal"],
    [{ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }, "refusal"],
    [{ candidates: [{ content: { role: "model", parts: [{ text: "Hel" }] }, finishReason: "MAX_TOKENS" }] }, "max_tokens"],
  ])("maps finish state %j to %s", async (body, expected) => {
    const { fetch } = scriptedFetch([json(body)]);
    const result = await new GeminiAdapter(key, { fetch }).generate({ model: "m", prompt: "p", maxOutputTokens: 5 });
    expect(result.stopReason).toBe(expected);
  });

  it("maps a missing model to model_not_found", async () => {
    const { fetch } = scriptedFetch([json({ error: { code: 404, message: "not found", status: "NOT_FOUND" } }, 404)]);
    expect(await kindOf(new GeminiAdapter(key, { fetch }).generate({ model: "nope", prompt: "p", maxOutputTokens: 5 }))).toBe(
      "model_not_found",
    );
  });
});

describe("adapter contract", () => {
  it("every adapter implements the same interface", () => {
    const adapters: ProviderAdapter[] = [new AnthropicAdapter(key), new OpenAiAdapter(key), new GeminiAdapter(key)];
    expect(adapters.map((a) => a.provider)).toEqual(["anthropic", "openai", "gemini"]);
  });
});
