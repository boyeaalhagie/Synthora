/**
 * Cloudflare Turnstile, used only when the server publishes a site key
 * (`/api/config`). Each protected request gets a fresh single-use token bound
 * to its action. The widget stays invisible unless Turnstile needs the user
 * to interact.
 */

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let config: Promise<{ turnstileSiteKey?: string }> | undefined;
let script: Promise<TurnstileApi> | undefined;

function publicConfig() {
  config ??= fetch("/api/config")
    .then((r) => (r.ok ? (r.json() as Promise<{ turnstileSiteKey?: string }>) : {}))
    .catch(() => ({}));
  return config;
}

function loadScript(): Promise<TurnstileApi> {
  script ??= new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = SCRIPT;
    tag.async = true;
    tag.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile failed to load")));
    tag.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.append(tag);
  });
  return script;
}

function container(): HTMLElement {
  let el = document.getElementById("turnstile");
  if (!el) {
    el = document.createElement("div");
    el.id = "turnstile";
    el.className = "fixed bottom-4 right-4 z-50";
    document.body.append(el);
  }
  return el;
}

/** Returns a token for `action`, or undefined when bot protection is not configured. */
export async function botToken(action: "verify" | "research"): Promise<string | undefined> {
  const { turnstileSiteKey } = await publicConfig();
  if (!turnstileSiteKey) return undefined;
  const turnstile = await loadScript();
  return new Promise((resolve, reject) => {
    const id = turnstile.render(container(), {
      sitekey: turnstileSiteKey,
      action,
      appearance: "interaction-only",
      callback: (token: string) => {
        resolve(token);
        turnstile.remove(id);
      },
      "error-callback": () => {
        reject(new Error("The browser check could not be completed. Reload the page and try again."));
        turnstile.remove(id);
      },
    });
  });
}
