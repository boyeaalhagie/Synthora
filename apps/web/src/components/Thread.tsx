import type { ExtractionResult, RejectedClaim, RejectedItem, RejectedSentence, ResearchPreviewResult } from "@synthora/schemas";
import { useEffect, useState, type ReactNode } from "react";
import { AiBot } from "../bot/AiBot.js";
import type { AiBotEmotion, AiBotMotion } from "../bot/engine.js";
import { formatDuration, formatNumber, humanize, studyLabel } from "../lib/format.js";
import { PROVIDER_LABELS, STEPS, type Run } from "../lib/types.js";
import { ProgressChecklist } from "./ProgressChecklist.js";
import { Badge, Button, Icon, Spinner } from "./ui.js";

const EXTRACTION_REJECTION: Record<RejectedItem["reason"], string> = {
  quote_too_short: "quote too short to verify",
  quote_not_in_source: "quote not found in the abstract",
  value_not_in_quote: "number not present in its quote",
  metric_not_in_quote: "metric value not present in its quote",
};

const CLAIM_REJECTION: Record<RejectedClaim["reason"], string> = {
  unknown_evidence: "cites evidence that does not exist",
  needs_multiple_papers: "comparison drawn from a single paper",
};

const SENTENCE_REJECTION: Record<RejectedSentence["reason"], string> = {
  no_evidence: "cites no evidence",
  unknown_evidence: "cites evidence that does not exist or was excluded",
  number_not_in_evidence: "states a number its evidence does not contain",
};

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function quoteOf(item: unknown): string | undefined {
  if (typeof item === "object" && item !== null && "quote" in item && typeof item.quote === "string") return item.quote;
  return undefined;
}

function Collapsible({
  summary,
  meta,
  children,
  tone = "default",
}: {
  summary: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  tone?: "default" | "warn";
}) {
  const [open, setOpen] = useState(false);
  const frame = tone === "warn" ? "border-warn-line bg-warn-soft" : "border-line bg-surface";
  return (
    <div className={`rounded-xl border ${frame}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm" aria-expanded={open}>
        <Icon name="chevron" className={`text-faint transition ${open ? "rotate-90" : ""}`} />
        <span className="flex-1">{summary}</span>
        {meta && <span className="text-xs text-faint">{meta}</span>}
      </button>
      {open && <div className={`border-t px-4 py-3 text-sm ${tone === "warn" ? "border-warn-line" : "border-line"}`}>{children}</div>}
    </div>
  );
}

function extractionBadge(e: ExtractionResult) {
  if (e.status === "extracted") return <Badge tone={e.rejected.length ? "warn" : "ok"}>extracted{e.rejected.length ? ` · ${e.rejected.length} rejected` : ""}</Badge>;
  if (e.status === "skipped") return <Badge>skipped</Badge>;
  return <Badge tone="bad">{humanize(e.reason)}</Badge>;
}

function recordSummary(result: ResearchPreviewResult): string {
  const checks = result.verification.papers;
  const withDoi = checks.filter((c) => c.crossref !== "no_doi");
  const matched = withDoi.filter((c) => c.crossref === "match").length;
  const retracted = checks.filter((c) => c.retracted).length;
  const parts = [withDoi.length ? `${matched} of ${withDoi.length} DOIs matched their Crossref record` : "No DOIs to check against Crossref"];
  if (retracted) parts.push(`${count(retracted, "retracted paper")} flagged`);
  return `${parts.join("; ")}.`;
}

function claimSummary(result: ResearchPreviewResult): string {
  const review = result.verification.claims;
  if (review.status === "skipped") return "No claims to review.";
  if (review.status === "failed") return `Claim review failed: ${review.message}`;
  const by = (v: string) => review.assessments.filter((a) => a.verdict === v).length;
  return `Claims reviewed against their quotes: ${by("supported")} supported, ${by("partially_supported")} partially supported, ${by("unsupported")} unsupported${by("not_assessed") ? `, ${by("not_assessed")} not reviewed` : ""}.`;
}

function reportSummary(result: ResearchPreviewResult): string {
  const report = result.report;
  if (report.status === "skipped") return report.reason === "no_analysis" ? "Skipped: nothing was analysed." : "Skipped: no claims survived review.";
  if (report.status === "failed") return `Failed: ${report.message}`;
  const written = report.sections.filter((s) => !s.generated).reduce((n, s) => n + s.paragraphs.flat().length, 0);
  return `${count(written, "cited sentence")} written, citing ${count(report.references.length, "paper")}${report.rejected.length ? `; ${count(report.rejected.length, "sentence")} removed by verification` : ""}.`;
}

function Steps({ result, elapsed }: { result: ResearchPreviewResult; elapsed: number }) {
  const extracted = result.extractions.filter((e) => e.status === "extracted").length;
  const failed = result.extractions.filter((e) => e.status === "failed");
  const analysis = result.analysis;
  const label = new Map(result.papers.map((p) => [p.id, studyLabel(p)]));

  return (
    <Collapsible
      summary={
        <>
          Planned and searched 2 sources, extracted {extracted} of {result.papers.length} papers,{" "}
          {analysis.status === "analyzed" ? "analysed and verified the evidence" : `analysis ${analysis.status}`}
        </>
      }
      meta={`${formatNumber(result.usage.inputTokens + result.usage.outputTokens)} tokens · ${formatDuration(elapsed)}`}
    >
      <ol className="flex flex-col gap-4">
        <li>
          <p className="font-medium">1. Search plan</p>
          {result.plan.status === "planned" ? (
            <div className="mt-1 flex flex-col gap-1.5 text-muted">
              <ul className="flex flex-col gap-0.5">
                {result.plan.concepts.map((c) => (
                  <li key={c.name}>
                    <span className="text-ink">{c.name}:</span> {c.terms.join(", ")}
                  </li>
                ))}
                {(result.plan.yearFrom !== null || result.plan.yearTo !== null) && (
                  <li>
                    Years: {result.plan.yearFrom ?? "any"}–{result.plan.yearTo ?? "present"}
                  </li>
                )}
              </ul>
              <code className="block rounded-md bg-sunken px-2 py-1 text-xs break-words">{result.plan.queries.pubmed}</code>
            </div>
          ) : (
            <p className="mt-1 text-muted">Searched the question as written: {result.plan.reason}</p>
          )}
        </li>
        <li>
          <p className="font-medium">2. Literature search</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-muted">
            {result.search.outcomes.map((o) => (
              <li key={o.source}>
                {o.source === "pubmed" ? "PubMed" : "Europe PMC"}:{" "}
                {o.status === "ok" ? `${formatNumber(o.returned)} of ${formatNumber(o.totalHits)} matches retrieved` : <span className="text-bad">{o.message}</span>}
              </li>
            ))}
            <li>
              Ranked {formatNumber(result.search.totalRetrieved)} records; selected the top {result.papers.length} with abstracts.
            </li>
          </ul>
        </li>
        <li>
          <p className="font-medium">3. Paper extraction</p>
          <ul className="mt-1 flex flex-col gap-1">
            {result.extractions.map((e) => (
              <li key={e.paperId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-muted">{label.get(e.paperId) ?? e.paperId}</span>
                {extractionBadge(e)}
              </li>
            ))}
          </ul>
          {failed.length > 0 && (
            <ul className="mt-2 flex flex-col gap-0.5 text-xs text-bad">
              {[...new Set(failed.map((f) => (f.status === "failed" ? f.message : "")))].map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </li>
        <li>
          <p className="font-medium">4. Evidence analysis</p>
          <p className="mt-1 text-muted">
            {analysis.status === "analyzed" &&
              `${count(analysis.evidence.length, "evidence item")} → ${count(analysis.findings.length, "finding")}, ${count(analysis.agreements.length, "agreement")}, ${count(analysis.conflicts.length, "conflict")}, ${count(analysis.gaps.length, "gap")}.`}
            {analysis.status === "skipped" && "Skipped: no verified evidence to analyse."}
            {analysis.status === "failed" && <span className="text-bad">{analysis.message} The comparison tables are still available.</span>}
          </p>
        </li>
        <li>
          <p className="font-medium">5. Citation verification</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-muted">
            <li>{recordSummary(result)}</li>
            <li>{claimSummary(result)}</li>
          </ul>
        </li>
        <li>
          <p className="font-medium">6. Report synthesis</p>
          <p className="mt-1 text-muted">{reportSummary(result)}</p>
        </li>
      </ol>
    </Collapsible>
  );
}

function Verifier({ result }: { result: ResearchPreviewResult }) {
  const label = new Map(result.papers.map((p) => [p.id, studyLabel(p)]));
  const items = result.extractions.flatMap((e) => (e.status === "extracted" ? e.rejected.map((r) => ({ paperId: e.paperId, r })) : []));
  const claims = result.analysis.status === "analyzed" ? result.analysis.rejected : [];
  const analysis = result.analysis;
  const review = result.verification.claims;
  const unsupported =
    analysis.status === "analyzed" && review.status === "assessed"
      ? review.assessments.filter((a) => a.verdict === "unsupported").map((a) => ({ a, claim: analysis[a.section][a.index] }))
      : [];
  const records = result.verification.papers.filter((c) => c.retracted || c.crossref === "mismatch");
  const sentences = result.report.status === "written" ? result.report.rejected : [];
  const total = items.length + claims.length + unsupported.length + records.length + sentences.length;

  if (total === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
        <Icon name="check" className="text-ok" /> Verifier: every quote, citation and paper record passed its checks.
      </p>
    );
  }

  return (
    <Collapsible
        tone="warn"
        summary={
          <span className="flex items-center gap-2 font-medium text-warn">
            <Icon name="alert" /> Verifier · {count(total, "issue")}
          </span>
        }
        meta="rejected items are excluded from the report"
      >
        <ul className="flex flex-col gap-3">
          {records.map((c) => (
            <li key={`r${c.paperId}`}>
              <p>
                <span className="font-medium">{label.get(c.paperId) ?? c.paperId}</span>:{" "}
                <span className="text-bad">
                  {[c.retracted && "marked as retracted", c.crossref === "mismatch" && "DOI is registered to a different title"].filter(Boolean).join("; ")}
                </span>
              </p>
              {c.crossref === "mismatch" && c.crossrefTitle && <p className="mt-1 text-xs text-muted">Crossref title: “{c.crossrefTitle}”</p>}
            </li>
          ))}
          {sentences.map((s, i) => (
            <li key={`s${i}`}>
              <p>
                <span className="font-medium">Report sentence</span> ({humanize(s.section)}):{" "}
                <span className="text-warn">{SENTENCE_REJECTION[s.reason]}{s.detail ? ` (${s.detail})` : ""}</span>
              </p>
              <p className="mt-1 text-xs text-muted">{s.sentence.text}</p>
            </li>
          ))}
          {unsupported.map(({ a, claim }, i) => (
            <li key={`u${i}`}>
              <p>
                <span className="font-medium">{humanize(a.section)} claim</span>: <span className="text-warn">not supported by its cited quotes</span>
              </p>
              {claim && <p className="mt-1 text-xs text-muted">{claim.statement}</p>}
              <p className="mt-1 text-xs text-faint">Reviewer: {a.explanation}</p>
            </li>
          ))}
          {items.map(({ paperId, r }, i) => (
            <li key={`i${i}`}>
              <p>
                <span className="font-medium">{label.get(paperId) ?? paperId}</span> · {humanize(r.field)}:{" "}
                <span className="text-warn">{EXTRACTION_REJECTION[r.reason]}</span>
              </p>
              {quoteOf(r.item) && <blockquote className="mt-1 border-l-2 border-warn-line pl-3 text-xs text-muted">“{quoteOf(r.item)}”</blockquote>}
            </li>
          ))}
          {claims.map((c, i) => (
            <li key={`c${i}`}>
              <p>
                <span className="font-medium">{humanize(c.section)} claim</span>: <span className="text-warn">{CLAIM_REJECTION[c.reason]}</span>
              </p>
              <p className="mt-1 text-xs text-muted">
                {c.claim.statement} <span className="text-faint">[{c.claim.evidence.join(", ")}]</span>
              </p>
            </li>
          ))}
        </ul>
    </Collapsible>
  );
}

const finishedSteps = (run: Run) => STEPS.filter((s) => ["done", "skipped", "failed"].includes(run.progress.steps[s].status)).length;

/** The bot mirrors the run: pondering while it works, a hop per finished step, joy, disappointment or a nap at the end. */
function StatusBot({ run }: { run: Run }) {
  const steps = finishedSteps(run);
  const emotion: AiBotEmotion =
    run.status === "running" ? "thinking" : run.status === "done" ? "happy" : run.status === "error" ? "sad" : "sleepy";
  const motion: AiBotMotion | null = run.status === "running" ? (steps > 0 ? "bounce" : null) : run.status === "done" ? "jump" : null;
  const label =
    run.status === "running"
      ? `Synthora is working: ${steps} of ${STEPS.length} steps finished`
      : run.status === "done"
        ? "Synthora finished the research"
        : run.status === "error"
          ? "Synthora could not finish the research"
          : "The research was cancelled";
  return <AiBot size={56} label={label} emotion={emotion} motion={motion} motionKey={steps} shape="pebble" lookAround={false} />;
}

function Running({ run, onCancel }: { run: Extract<Run, { status: "running" }>; onCancel: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <StatusBot run={run} />
        <div className="flex-1 text-sm">
          <p className="font-medium" aria-live="polite">
            Working · {formatDuration(now - run.startedAt)}
          </p>
          <p className="text-muted">
            {PROVIDER_LABELS[run.provider]} · {run.model}. Usually one to three minutes.
          </p>
        </div>
        <Button variant="ghost" onClick={onCancel}>
          <Icon name="stop" /> Cancel
        </Button>
      </div>
      <ProgressChecklist progress={run.progress} topN={run.topN} />
    </div>
  );
}

export function Thread({ run, onCancel }: { run: Run; onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="ml-auto max-w-[85%] rounded-2xl bg-sunken px-4 py-3 text-sm">{run.query}</div>

      {run.status === "running" && <Running run={run} onCancel={onCancel} />}

      {run.status === "saved" &&
        (run.loadError ? (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">
            <Icon name="alert" className="mt-0.5" />
            {run.loadError}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
            <Spinner className="text-accent" /> Loading saved research…
          </p>
        ))}

      {(run.status === "error" || run.status === "cancelled") && (
        <>
          <div className="flex items-center gap-3">
            <StatusBot run={run} />
            <p role="alert" className={`flex flex-1 items-start gap-2 rounded-xl px-4 py-3 text-sm ${run.status === "error" ? "bg-bad-soft text-bad" : "bg-sunken text-muted"}`}>
              <Icon name={run.status === "error" ? "alert" : "stop"} className="mt-0.5" />
              {run.message}
            </p>
          </div>
          <ProgressChecklist progress={run.progress} topN={run.topN} />
        </>
      )}

      {run.status === "done" && (
        <>
          <div className="flex items-center gap-3">
            <StatusBot run={run} />
            <p className="text-sm">
              <span className="font-medium">Done in {formatDuration(run.finishedAt - run.startedAt)}.</span>{" "}
              <span className="text-muted">The report is ready on the right.</span>
            </p>
          </div>
          <Steps result={run.result} elapsed={run.finishedAt - run.startedAt} />
          <Verifier result={run.result} />
          <p className="text-sm text-muted">
            Every sentence in the report links to the quotes it rests on. Click a citation to read them, and check the source before relying on a
            finding.
          </p>
        </>
      )}
    </div>
  );
}
