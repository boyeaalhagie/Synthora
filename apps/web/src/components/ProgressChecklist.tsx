import type { PipelineStep } from "@synthora/schemas";
import { STEPS, type Progress, type StepState } from "../lib/types.js";

const LABELS: Record<PipelineStep, (topN: number) => string> = {
  search: () => "Search PubMed and Europe PMC",
  extract: (n) => `Extract the top ${n} ${n === 1 ? "paper" : "papers"}`,
  analyze: () => "Compare evidence across papers",
  verify: () => "Verify citations and claims",
  report: () => "Write the report",
};

const finished = (s: StepState) => s.status === "done" || s.status === "skipped" || s.status === "failed";

/** Circular progress mark for the header: a filled wedge proportional to completed steps. */
function Ring({ fraction }: { fraction: number }) {
  const angle = fraction * 2 * Math.PI;
  const x = 8 + 4 * Math.sin(angle);
  const y = 8 - 4 * Math.cos(angle);
  const wedge =
    fraction <= 0 ? "" : fraction >= 1 ? "M8 4a4 4 0 1 1 0 8a4 4 0 1 1 0-8Z" : `M8 8L8 4A4 4 0 ${angle > Math.PI ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z`;
  return (
    <svg viewBox="0 0 16 16" className="size-4 text-ink" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 1.6" />
      {wedge && <path d={wedge} fill="currentColor" />}
    </svg>
  );
}

function StatusIcon({ status }: { status: StepState["status"] }) {
  const common = { viewBox: "0 0 16 16", className: "size-4 shrink-0", "aria-hidden": true } as const;
  switch (status) {
    case "done":
      return (
        <svg {...common} className={`${common.className} text-faint`}>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M5.3 8.2l1.8 1.8 3.6-3.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "running":
      return (
        <svg {...common} className={`${common.className} text-ink`}>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5 8h5.6M8.4 5.6L10.8 8l-2.4 2.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "failed":
      return (
        <svg {...common} className={`${common.className} text-bad`}>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    default:
      // pending and skipped: a dashed, empty circle.
      return (
        <svg {...common} className={`${common.className} text-faint`}>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 1.6" />
        </svg>
      );
  }
}

export function ProgressChecklist({ progress, topN }: { progress: Progress; topN: number }) {
  const done = STEPS.filter((s) => finished(progress.steps[s])).length;
  return (
    <section aria-label="Research progress" className="rounded-xl border border-line bg-surface px-4 py-3">
      <header className="flex items-center gap-3 pb-1">
        <Ring fraction={done / STEPS.length} />
        <h3 className="flex-1 text-sm font-medium">Research steps</h3>
        <span className="text-sm tabular-nums text-faint" aria-label={`${done} of ${STEPS.length} steps finished`}>
          {done}/{STEPS.length}
        </span>
      </header>
      <ol className="flex flex-col">
        {STEPS.map((step) => {
          const state = progress.steps[step];
          const extract = step === "extract" && state.status === "running" ? progress.extract : null;
          const tone =
            state.status === "running"
              ? "text-ink"
              : state.status === "done"
                ? "text-faint line-through decoration-faint/70"
                : state.status === "failed"
                  ? "text-bad"
                  : "text-faint";
          return (
            <li key={step} className="flex gap-3 py-1.5" aria-current={state.status === "running" ? "step" : undefined}>
              <span className="pt-0.5">
                <StatusIcon status={state.status} />
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${tone}`}>
                  {LABELS[step](topN)}
                  {state.status === "skipped" && <span className="ml-2 text-xs no-underline">skipped</span>}
                </p>
                {extract && extract.total > 0 && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-chip">
                      <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(100 * extract.completed) / extract.total}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-muted">
                      {extract.completed} of {extract.total}
                    </span>
                  </div>
                )}
                {state.detail && state.status !== "running" && <p className="mt-0.5 text-xs text-faint no-underline">{state.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
