import type { LlmProvider, ModelInfo, ProviderErrorKind } from "@synthora/schemas";
import { useEffect, useRef, useState } from "react";
import { ApiError, verifyProvider } from "../lib/api.js";
import { PROVIDER_LABELS, type Connection } from "../lib/types.js";
import { Button, Icon, Spinner } from "./ui.js";

const PROVIDERS: LlmProvider[] = ["anthropic", "openai", "gemini"];

/** Preferred defaults when the provider lists them; otherwise the user picks. */
const PREFERRED_MODEL: Partial<Record<LlmProvider, string>> = { anthropic: "claude-opus-5-5" };

const ERROR_HINTS: Partial<Record<ProviderErrorKind, string>> = {
  invalid_key: "Check that you copied the whole key and picked the matching provider.",
  rate_limited: "Wait a moment, or check your provider's billing and quota.",
  permission_denied: "The key exists but cannot list models. Check its permissions.",
};

type Status =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "error"; message: string }
  | { kind: "verified"; models: ModelInfo[] };

export function ConnectDialog({
  current,
  onConnect,
  onDisconnect,
  onClose,
}: {
  current: Connection | null;
  onConnect: (connection: Connection) => void;
  onDisconnect: () => void;
  onClose: () => void;
}) {
  const [provider, setProvider] = useState<LlmProvider>(current?.provider ?? "anthropic");
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<Status>(current ? { kind: "verified", models: current.models } : { kind: "idle" });
  const [model, setModel] = useState(current?.model ?? "");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const editingCurrent = current !== null && key === "" && provider === current.provider;

  async function verify() {
    setStatus({ kind: "verifying" });
    try {
      const result = await verifyProvider(provider, key.trim());
      if (!result.valid) {
        setStatus({ kind: "error", message: [result.error.message, ERROR_HINTS[result.error.kind]].filter(Boolean).join(" ") });
        return;
      }
      if (result.models.length === 0) {
        setStatus({ kind: "error", message: "The key works, but the provider reported no models for it." });
        return;
      }
      const preferred = PREFERRED_MODEL[provider];
      setModel(result.models.some((m) => m.id === preferred) ? preferred! : result.models[0]!.id);
      setStatus({ kind: "verified", models: result.models });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof ApiError ? err.message : "Verification failed unexpectedly." });
    }
  }

  function save() {
    if (status.kind !== "verified" || !model) return;
    onConnect({ provider, key: editingCurrent ? current.key : key.trim(), models: status.models, model });
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/40"
    >
      <form
        method="dialog"
        className="flex flex-col gap-5 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (status.kind === "verified") save();
          else void verify();
        }}
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-xl font-semibold">Connect your AI provider</h2>
            <p className="mt-1 text-sm text-muted">You supply and pay for your own API usage.</p>
          </div>
          <Button variant="ghost" aria-label="Close" onClick={() => dialog.current?.close()}>
            <Icon name="x" />
          </Button>
        </header>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Provider</legend>
          <div className="grid grid-cols-3 gap-2">
            {PROVIDERS.map((p) => (
              <label
                key={p}
                className={`cursor-pointer rounded-lg border px-3 py-2 text-center text-sm transition ${
                  provider === p ? "border-accent bg-sunken font-medium" : "border-line hover:bg-sunken"
                }`}
              >
                <input
                  type="radio"
                  name="provider"
                  value={p}
                  checked={provider === p}
                  onChange={() => {
                    setProvider(p);
                    setStatus({ kind: "idle" });
                  }}
                  className="sr-only"
                />
                {PROVIDER_LABELS[p]}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">API key</span>
          <div className="flex gap-2">
            <input
              type={showKey ? "text" : "password"}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                if (status.kind !== "verifying") setStatus({ kind: "idle" });
              }}
              placeholder={editingCurrent ? "Connected — enter a new key to replace it" : "Paste your key"}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-line bg-sunken px-3 py-2 font-mono text-sm outline-none focus:border-accent"
            />
            <Button variant="secondary" onClick={() => setShowKey((s) => !s)}>
              {showKey ? "Hide" : "Show"}
            </Button>
          </div>
          <span className="text-xs text-muted">
            Kept only in this tab's memory and sent in a request header to the Synthora server, which passes it to the provider. It is never
            stored. Reloading the page disconnects.
          </span>
        </label>

        {status.kind === "error" && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
            <Icon name="alert" className="mt-0.5" />
            {status.message}
          </p>
        )}

        {status.kind === "verified" && (
          <label className="flex flex-col gap-2">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Icon name="check" className="text-ok" /> Key verified — choose a model
            </span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="rounded-lg border border-line bg-sunken px-3 py-2 text-sm outline-none focus:border-accent"
            >
              {status.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName ? `${m.displayName} (${m.id})` : m.id}
                </option>
              ))}
            </select>
            {provider === "openai" && <span className="text-xs text-muted">OpenAI lists every model type; pick a text model.</span>}
          </label>
        )}

        <footer className="flex items-center justify-between gap-2">
          {current ? (
            <Button
              variant="danger"
              onClick={() => {
                onDisconnect();
                dialog.current?.close();
              }}
            >
              Disconnect
            </Button>
          ) : (
            <span />
          )}
          {/* Editing the key or provider resets status, so "verified" always refers to the key shown. */}
          {status.kind === "verified" ? (
            <Button variant="primary" type="submit" disabled={!model}>
              Use {model || "model"}
            </Button>
          ) : (
            <Button variant="primary" type="submit" disabled={key.trim().length < 20 || status.kind === "verifying"}>
              {status.kind === "verifying" ? <Spinner /> : <Icon name="key" />}
              Connect and verify
            </Button>
          )}
        </footer>
      </form>
    </dialog>
  );
}
