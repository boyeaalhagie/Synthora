import { useEffect, useRef, useState } from "react";
import { Composer } from "./components/Composer.js";
import { ConnectDialog } from "./components/ConnectDialog.js";
import { PrintReport } from "./components/ReportDocument.js";
import { ReportPanel } from "./components/ReportPanel.js";
import { Sidebar } from "./components/Sidebar.js";
import { Thread } from "./components/Thread.js";
import { AiBot } from "./bot/AiBot.js";
import { ApiError, deleteSession, getSession, listSessions, runPreviewStream } from "./lib/api.js";
import { applyProgress, initialProgress, savedRun, type Connection, type Run } from "./lib/types.js";

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

  // Saved research for this browser, oldest first so the sidebar (which lists newest first) stays consistent.
  useEffect(() => {
    let cancelled = false;
    void listSessions().then((sessions) => {
      if (cancelled || sessions.length === 0) return;
      setRuns((all) => {
        const known = new Set(all.map((r) => r.sessionId));
        return [...sessions.filter((s) => !known.has(s.id)).reverse().map(savedRun), ...all];
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Opening a saved run fetches its full result once.
  useEffect(() => {
    if (active?.status !== "saved" || active.loadError) return;
    const { id, sessionId } = active;
    let cancelled = false;
    getSession(sessionId)
      .then((record) => {
        if (!cancelled) update(id, (run) => (run.status === "saved" ? { ...run, status: "done", result: record.result } : run));
      })
      .catch((err: unknown) => {
        if (!cancelled) update(id, (run) => (run.status === "saved" ? { ...run, loadError: err instanceof ApiError ? err.message : "Could not load this research." } : run));
      });
    return () => {
      cancelled = true;
    };
  }, [active?.id, active?.status]);

  async function removeRun(run: Run) {
    if (!window.confirm(`Delete “${run.query}”? This cannot be undone.`)) return;
    try {
      if (run.sessionId) await deleteSession(run.sessionId);
      setRuns((all) => all.filter((r) => r.id !== run.id));
      if (activeId === run.id) setActiveId(null);
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "Could not delete this research.");
    }
  }

  async function startRun(query: string, topN: number) {
    if (!connection) return;
    const id = crypto.randomUUID();
    const base = { id, query, topN, provider: connection.provider, model: connection.model, startedAt: Date.now() };
    const controller = new AbortController();
    controllers.current.set(id, controller);
    setRuns((all) => [...all, { ...base, status: "running", progress: initialProgress() }]);
    setActiveId(id);

    try {
      const { result, sessionId } = await runPreviewStream(
        { query, provider: connection.provider, model: connection.model, topN },
        connection.key,
        (event) => update(id, (run) => ({ ...run, progress: applyProgress(run.progress, event) })),
        controller.signal,
      );
      update(id, (run) => ({ ...base, progress: run.progress, status: "done", finishedAt: Date.now(), result, ...(sessionId && { sessionId }) }));
    } catch (err) {
      const cancelled = err instanceof DOMException && err.name === "AbortError";
      update(id, (run) => ({
        ...base,
        progress: run.progress,
        status: cancelled ? "cancelled" : "error",
        finishedAt: Date.now(),
        message: cancelled
          ? "Cancelled. The server stops before its next model call; a call already in flight may still be billed."
          : err instanceof ApiError
            ? err.message
            : "Something went wrong while running this research.",
      }));
    } finally {
      controllers.current.delete(id);
    }
  }

  const printable = active?.status === "done" && active.result.report.status === "written" ? active.result.report : null;

  return (
    <>
    {printable && (
      <div className="print-only">
        <PrintReport report={printable} />
      </div>
    )}
    <div className="screen-only flex min-h-full flex-col gap-3 p-3 lg:h-full lg:flex-row">
      <Sidebar
        runs={runs}
        activeRunId={activeId}
        connection={connection}
        onSelect={setActiveId}
        onDelete={(run) => void removeRun(run)}
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
              <div className="mx-auto flex max-w-xl flex-col gap-3 pt-[8vh]">
                <AiBot size={88} label="Synthora" emotion={connection ? "happy" : "neutral"} followCursor className="-ml-2" />
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
    </>
  );
}
