import { useRef, useState } from "react";
import { Composer } from "./components/Composer.js";
import { ConnectDialog } from "./components/ConnectDialog.js";
import { ReportPanel } from "./components/ReportPanel.js";
import { Sidebar } from "./components/Sidebar.js";
import { Thread } from "./components/Thread.js";
import { ApiError, runPreview } from "./lib/api.js";
import type { Connection, Run } from "./lib/types.js";

export function App() {
  // The key lives only here, in memory. Nothing in this app persists it.
  const [connection, setConnection] = useState<Connection | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const controllers = useRef(new Map<string, AbortController>());

  const active = runs.find((r) => r.id === activeId) ?? null;
  const busy = runs.some((r) => r.status === "running");

  const update = (id: string, next: (run: Run) => Run) => setRuns((all) => all.map((r) => (r.id === id ? next(r) : r)));

  async function startRun(query: string, topN: number) {
    if (!connection) return;
    const id = crypto.randomUUID();
    const base = { id, query, topN, provider: connection.provider, model: connection.model, startedAt: Date.now() };
    const controller = new AbortController();
    controllers.current.set(id, controller);
    setRuns((all) => [...all, { ...base, status: "running" }]);
    setActiveId(id);

    try {
      const result = await runPreview({ query, provider: connection.provider, model: connection.model, topN }, connection.key, controller.signal);
      update(id, () => ({ ...base, status: "done", finishedAt: Date.now(), result }));
    } catch (err) {
      const cancelled = err instanceof DOMException && err.name === "AbortError";
      update(id, () => ({
        ...base,
        status: cancelled ? "cancelled" : "error",
        finishedAt: Date.now(),
        message: cancelled
          ? "Cancelled. Calls already sent to the provider may still complete and be billed."
          : err instanceof ApiError
            ? err.message
            : "Something went wrong while running this research.",
      }));
    } finally {
      controllers.current.delete(id);
    }
  }

  return (
    <div className="flex min-h-full flex-col gap-3 p-3 lg:h-full lg:flex-row">
      <Sidebar
        runs={runs}
        activeRunId={activeId}
        connection={connection}
        onSelect={setActiveId}
        onNew={() => setActiveId(null)}
        onConnect={() => setDialogOpen(true)}
      />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:flex-row">
        <section className={`flex min-h-0 flex-col rounded-2xl bg-surface/60 ${active?.status === "done" ? "lg:w-[44%] lg:shrink-0" : "flex-1"}`}>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-6">
            {active ? (
              <>
                <p className="mb-4 truncate text-sm font-medium text-muted">{active.query}</p>
                <Thread run={active} onCancel={() => controllers.current.get(active.id)?.abort()} />
              </>
            ) : (
              <div className="mx-auto flex max-w-xl flex-col gap-3 pt-[10vh]">
                <h2 className="font-serif text-3xl font-semibold tracking-tight">What would you like to research?</h2>
                <p className="text-sm text-muted">
                  Synthora searches PubMed and Europe PMC, extracts each top paper with your model, verifies every extracted quote against the
                  abstract, and compares the evidence across papers. Every claim in the report cites the passage it comes from.
                </p>
              </div>
            )}
          </div>
          <div className="p-4 lg:px-6">
            <Composer connection={connection} busy={busy} onRun={startRun} onConnect={() => setDialogOpen(true)} showExamples={!active} />
          </div>
        </section>

        {active?.status === "done" && <ReportPanel key={active.id} result={active.result} query={active.query} />}
      </main>

      {dialogOpen && (
        <ConnectDialog
          current={connection}
          onConnect={(c) => {
            setConnection(c);
            setDialogOpen(false);
          }}
          onDisconnect={() => setConnection(null)}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}
