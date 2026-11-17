/**
 * Anonymous ownership. Each browser gets a random session token in an
 * HttpOnly cookie; the server stores only its SHA-256, so the database never
 * holds a usable token. No accounts, no personal data.
 */

export const SESSION_COOKIE = "synthora_sid";
const ONE_YEAR = 60 * 60 * 24 * 365;

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

export interface Owner {
  /** Hash used as the owner id in storage. */
  id: string;
  /** Set-Cookie value to send when a new token was issued. */
  setCookie?: string;
}

/** Tokens are 32 random bytes, base64url: anything else is ignored and replaced. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export async function resolveOwner(request: Request): Promise<Owner> {
  const existing = readCookie(request, SESSION_COOKIE);
  if (existing && TOKEN.test(existing)) return { id: await hashToken(existing) };

  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return {
    id: await hashToken(token),
    setCookie: `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_YEAR}${secure}`,
  };
}
