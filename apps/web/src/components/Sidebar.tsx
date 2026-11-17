import { PROVIDER_LABELS, type Connection, type Run } from "../lib/types.js";
import { Button, Icon, Spinner } from "./ui.js";

export function Sidebar({
  runs,
  activeRunId,
  connection,
  onSelect,
  onNew,
  onConnect,
}: {
  runs: readonly Run[];
  activeRunId: string | null;
  connection: Connection | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onConnect: () => void;
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-6 rounded-2xl bg-surface p-4 lg:w-64">
      <div>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Synthora</h1>
        <p className="text-xs text-faint">Research synthesis · preview</p>
      </div>

      <nav className="flex flex-col gap-1">
        <Button variant="ghost" className="justify-start" onClick={onNew}>
          <Icon name="plus" /> New research
        </Button>
      </nav>

      <section className="flex min-h-0 flex-1 flex-col gap-1">
        <h2 className="px-3 text-xs font-medium text-faint">Research</h2>
        {runs.length === 0 && <p className="px-3 text-sm text-faint">No research yet.</p>}
        <ul className="flex flex-col gap-0.5 overflow-y-auto">
          {[...runs].reverse().map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => onSelect(run.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                  run.id === activeRunId ? "bg-sunken font-medium text-ink" : "text-muted hover:bg-sunken"
                }`}
              >
                {run.status === "running" ? (
                  <Spinner className="size-3 text-accent" />
                ) : (
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${run.status === "done" ? "bg-ok" : run.status === "error" ? "bg-bad" : "bg-faint"}`}
                  />
                )}
                <span className="truncate">{run.query}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="px-3 pt-2 text-xs text-faint">Sessions are kept in this tab only for now.</p>
      </section>

      <button
        type="button"
        onClick={onConnect}
        className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left text-sm transition hover:bg-sunken"
      >
        <span className={`size-2 shrink-0 rounded-full ${connection ? "bg-ok" : "bg-faint"}`} />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{connection ? PROVIDER_LABELS[connection.provider] : "Connect a provider"}</span>
          <span className="block truncate text-xs text-muted">{connection ? connection.model : "Bring your own API key"}</span>
        </span>
        <Icon name="key" className="text-muted" />
      </button>
    </aside>
  );
}
