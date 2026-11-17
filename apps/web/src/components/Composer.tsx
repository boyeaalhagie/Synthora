import { useState } from "react";
import { PROVIDER_LABELS, type Connection } from "../lib/types.js";
import { Button, Icon } from "./ui.js";

const EXAMPLES = [
  "Machine learning models for predicting cardiovascular disease risk: which perform best and what are their limitations?",
  "Deep learning for diabetic retinopathy screening: diagnostic accuracy in primary care",
  "Large language models for clinical note summarisation: evaluation methods and reported accuracy",
];

export function Composer({
  connection,
  busy,
  onRun,
  onConnect,
  showExamples,
}: {
  connection: Connection | null;
  busy: boolean;
  onRun: (query: string, topN: number) => void;
  onConnect: () => void;
  showExamples: boolean;
}) {
  const [query, setQuery] = useState("");
  const [topN, setTopN] = useState(3);
  const valid = query.trim().length >= 3;

  function submit() {
    if (!connection) return onConnect();
    if (!valid || busy) return;
    onRun(query.trim(), topN);
    setQuery("");
  }

  return (
    <div className="flex flex-col gap-3">
      {showExamples && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-faint">Try an example</p>
          {EXAMPLES.map((e) => (
            <button key={e} type="button" onClick={() => setQuery(e)} className="rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm text-muted transition hover:text-ink">
              {e}
            </button>
          ))}
        </div>
      )}
      <form
        className="rounded-2xl border border-line bg-surface p-3 shadow-sm focus-within:border-accent"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="question" className="sr-only">
          Research question
        </label>
        <textarea
          id="question"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          maxLength={1000}
          placeholder="Ask a research question…"
          className="w-full resize-none bg-transparent px-1 text-sm outline-none placeholder:text-faint"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            Papers to extract
            <select value={topN} onChange={(e) => setTopN(Number(e.target.value))} className="rounded-md border border-line bg-sunken px-1.5 py-1 text-xs">
              {[1, 2, 3, 5, 8, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onConnect} className="truncate text-xs text-muted hover:text-ink">
            {connection ? `${PROVIDER_LABELS[connection.provider]} · ${connection.model}` : "No provider connected"}
          </button>
          <Button variant="primary" type="submit" className="ml-auto" disabled={busy || (connection !== null && !valid)} aria-label="Run research">
            {connection ? <Icon name="send" /> : <Icon name="key" />}
            {connection ? "Run" : "Connect"}
          </Button>
        </div>
      </form>
      <p className="text-center text-xs text-faint">Each paper costs one or two model calls, plus one for the analysis, billed to your key.</p>
    </div>
  );
}
