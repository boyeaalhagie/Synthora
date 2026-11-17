import type { FetchFn } from "../lib/http.js";

/** Actions that spend money or can be abused, each limited and (optionally) bot-checked separately. */
export type ProtectedAction = "verify" | "research";

export const TURNSTILE_HEADER = "x-turnstile-token";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface Protection {
  /** Cloudflare rate limit bindings, per action. Missing limiters are skipped. */
  limiters?: Partial<Record<ProtectedAction, RateLimit>>;
  /** When set, protected actions need a valid Turnstile token. */
  turnstile?: { secret: string; fetch: FetchFn };
}

export type Verdict = { ok: true } | { ok: false; status: 403 | 429; error: string; retryAfter?: number };

/**
 * Identifies the client for rate limiting. Cloudflare sets CF-Connecting-IP
 * at the edge and clients cannot override it there. The cookie is not used:
 * an abuser can simply drop it.
 */
export function clientKey(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "local";
}

const TurnstileReply = (v: unknown): v is { success: boolean; action?: string } =>
  typeof v === "object" && v !== null && "success" in v && typeof v.success === "boolean";

async function verifyTurnstile(request: Request, action: ProtectedAction, turnstile: NonNullable<Protection["turnstile"]>): Promise<boolean> {
  const token = request.headers.get(TURNSTILE_HEADER);
  if (!token || token.length > 2048) return false;
  const form = new URLSearchParams({ secret: turnstile.secret, response: token });
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) form.set("remoteip", ip);
  try {
    const response = await turnstile.fetch(SITEVERIFY, { method: "POST", body: form, signal: AbortSignal.timeout(10_000) });
    const reply: unknown = await response.json();
    // The action ties a token to what it was issued for, so a token from one action cannot be replayed on another.
    return TurnstileReply(reply) && reply.success && reply.action === action;
  } catch {
    // If Turnstile cannot be reached, fail closed: protected actions spend users' money.
    return false;
  }
}

/** Rate limit first (cheap, local), then the bot check (a network call). */
export async function checkProtection(request: Request, action: ProtectedAction, protection: Protection | undefined): Promise<Verdict> {
  const limiter = protection?.limiters?.[action];
  if (limiter) {
    const { success } = await limiter.limit({ key: `${action}:${clientKey(request)}` });
    if (!success) return { ok: false, status: 429, error: "Too many requests. Please wait a minute and try again.", retryAfter: 60 };
  }
  if (protection?.turnstile && !(await verifyTurnstile(request, action, protection.turnstile))) {
    return { ok: false, status: 403, error: "The browser check failed. Reload the page and try again." };
  }
  return { ok: true };
}
