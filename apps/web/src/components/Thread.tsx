import type { ExtractionResult, RejectedClaim, RejectedItem, ResearchPreviewResult } from "@synthora/schemas";
import { useEffect, useState, type ReactNode } from "react";
import { formatDuration, formatNumber, humanize, studyLabel } from "../lib/format.js";
import { PROVIDER_LABELS, type Run } from "../lib/types.js";
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

function Steps({ result, elapsed }: { result: ResearchPreviewResult; elapsed: number }) {
  const extracted = result.extractions.filter((e) => e.status === "extracted").length;
  const failed = result.extractions.filter((e) => e.status === "failed");
  const analysis = result.analysis;
  const label = new Map(result.papers.map((p) => [p.id, studyLabel(p)]));

  return (
    <Collapsible
      summary={
        <>
          Searched 2 sources, extracted {extracted} of {result.papers.length} papers,{" "}
          {analysis.status === "analyzed" ? "analysed and verified the evidence" : `analysis ${analysis.status}`}
        </>
      }
      meta={`${formatNumber(result.usage.inputTokens + result.usage.outputTokens)} tokens · ${formatDuration(elapsed)}`}
    >
      <ol className="flex flex-col gap-4">
        <li>
          <p className="font-medium">1. Literature search</p>
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
          <p className="font-medium">2. Paper extraction</p>
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
          <p className="font-medium">3. Evidence analysis</p>
          <p className="mt-1 text-muted">
            {analysis.status === "analyzed" &&
              `${count(analysis.evidence.length, "evidence item")} → ${count(analysis.findings.length, "finding")}, ${count(analysis.agreements.length, "agreement")}, ${count(analysis.conflicts.length, "conflict")}, ${count(analysis.gaps.length, "gap")}.`}
            {analysis.status === "skipped" && "Skipped: no verified evidence to analyse."}
            {analysis.status === "failed" && <span className="text-bad">{analysis.message} The comparison tables are still available.</span>}
          </p>
        </li>
        <li>
          <p className="font-medium">4. Citation verification</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-muted">
            <li>{recordSummary(result)}</li>
            <li>{claimSummary(result)}</li>
          </ul>
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
  const total = items.length + claims.length + unsupported.length + records.length;

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

function Running({ run, onCancel }: { run: Extract<Run, { status: "running" }>; onCancel: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
      <Spinner className="mt-0.5 text-accent" />
      <div className="flex-1">
        <p className="font-medium">Running · {formatDuration(now - run.startedAt)}</p>
        <p className="mt-1 text-muted">
          Searching PubMed and Europe PMC, extracting the top {run.topN} papers with {PROVIDER_LABELS[run.provider]} ({run.model}), then analysing
          across them. This usually takes one to three minutes. Step details appear when the run finishes.
        </p>
      </div>
      <Button variant="ghost" onClick={onCancel}>
        <Icon name="stop" /> Cancel
      </Button>
    </div>
  );
}

export function Thread({ run, onCancel }: { run: Run; onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="ml-auto max-w-[85%] rounded-2xl bg-sunken px-4 py-3 text-sm">{run.query}</div>

      {run.status === "running" && <Running run={run} onCancel={onCancel} />}

      {(run.status === "error" || run.status === "cancelled") && (
        <p role="alert" className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${run.status === "error" ? "bg-bad-soft text-bad" : "bg-sunken text-muted"}`}>
          <Icon name={run.status === "error" ? "alert" : "stop"} className="mt-0.5" />
          {run.message}
        </p>
      )}

      {run.status === "done" && (
        <>
          <Steps result={run.result} elapsed={run.finishedAt - run.startedAt} />
          <Verifier result={run.result} />
          <p className="text-sm text-muted">
            The report is on the right. Every claim links to the quote it rests on — click an evidence chip to read it, and check the source before relying
            on a finding.
          </p>
        </>
      )}
    </div>
  );
}
