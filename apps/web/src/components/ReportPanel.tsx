import type {
  AnalysisSection,
  ClaimAssessment,
  EvidenceItem,
  ExtractionResult,
  PaperCheck,
  PaperExtraction,
  RankedPaper,
  ResearchPreviewResult,
  VerifiedClaim,
} from "@synthora/schemas";
import { useMemo, useState, type ReactNode } from "react";
import { formatNumber, humanize, paperLinks, shortAuthors, studyLabel } from "../lib/format.js";
import { Badge, Icon } from "./ui.js";

type Tab = "analysis" | "studies" | "metrics" | "papers";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "analysis", label: "Analysis" },
  { id: "studies", label: "Studies" },
  { id: "metrics", label: "Metrics" },
  { id: "papers", label: "Papers" },
];

interface Lookup {
  evidence: Map<string, EvidenceItem>;
  papers: Map<string, RankedPaper>;
  checks: Map<string, PaperCheck>;
  /** "findings:0" -> the reviewer's verdict on that claim. */
  assessments: Map<string, ClaimAssessment>;
}

const VERDICT_BADGE: Record<ClaimAssessment["verdict"], { tone: "ok" | "warn" | "bad" | "neutral"; label: string }> = {
  supported: { tone: "ok", label: "Supported" },
  partially_supported: { tone: "warn", label: "Partially supported" },
  unsupported: { tone: "bad", label: "Unsupported" },
  not_assessed: { tone: "neutral", label: "Not reviewed" },
};

function RecordBadges({ check }: { check: PaperCheck | undefined }) {
  if (!check) return null;
  return (
    <>
      {check.retracted && <Badge tone="bad">Retracted</Badge>}
      {check.crossref === "match" && <Badge tone="ok">DOI verified</Badge>}
      {check.crossref === "mismatch" && (
        <span title={check.crossrefTitle ? `Crossref title: ${check.crossrefTitle}` : undefined}>
          <Badge tone="bad">DOI points to a different title</Badge>
        </span>
      )}
      {check.crossref === "not_in_crossref" && <Badge>DOI not in Crossref</Badge>}
      {check.crossref === "error" && <Badge>Crossref unavailable</Badge>}
    </>
  );
}

function ExternalLinks({ paper }: { paper: RankedPaper }) {
  return (
    <span className="inline-flex flex-wrap gap-2">
      {paperLinks(paper).map((link) => (
        <a key={link.label} href={link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
          {link.label} <Icon name="external" />
        </a>
      ))}
    </span>
  );
}

function EvidenceCard({ item, lookup }: { item: EvidenceItem; lookup: Lookup }) {
  const paper = lookup.papers.get(item.paperId);
  return (
    <div className="rounded-lg border border-line bg-sunken p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-mono font-medium text-ink">{item.id}</span>
        <span>{paper ? studyLabel(paper) : item.paperId}</span>
        <span>· {humanize(item.field)}</span>
        {paper && <ExternalLinks paper={paper} />}
      </p>
      <p className="mt-1">{item.value}</p>
      <blockquote className="mt-2 border-l-2 border-accent/50 pl-3 text-muted">“{item.quote}”</blockquote>
    </div>
  );
}

function Claim({ claim, assessment, lookup }: { claim: VerifiedClaim; assessment: ClaimAssessment | undefined; lookup: Lookup }) {
  const [open, setOpen] = useState<string | null>(null);
  const item = open ? lookup.evidence.get(open) : undefined;
  const badge = assessment ? VERDICT_BADGE[assessment.verdict] : undefined;
  return (
    <li className="flex flex-col gap-2">
      <p className="leading-relaxed">
        {badge && (
          <span className="mr-1.5" title={assessment?.explanation}>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </span>
        )}
        {claim.statement}{" "}
        {claim.evidence.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setOpen((current) => (current === id ? null : id))}
            aria-expanded={open === id}
            className={`mx-0.5 rounded px-1 py-px font-mono text-xs transition ${open === id ? "bg-accent text-accent-ink" : "bg-chip text-muted hover:text-ink"}`}
          >
            {id}
          </button>
        ))}
      </p>
      {assessment?.verdict === "partially_supported" && (
        <p className="text-xs text-muted">
          <span className="font-medium">Reviewer:</span> {assessment.explanation}
        </p>
      )}
      {item && <EvidenceCard item={item} lookup={lookup} />}
    </li>
  );
}

function Section({ section, title, hint, claims, lookup }: { section: AnalysisSection; title: string; hint: string; claims: VerifiedClaim[]; lookup: Lookup }) {
  // Claims the reviewer judged unsupported are left out of the report; the Verifier card lists them.
  const shown = claims
    .map((claim, index) => ({ claim, assessment: lookup.assessments.get(`${section}:${index}`), index }))
    .filter(({ assessment }) => assessment?.verdict !== "unsupported");
  return (
    <section>
      <h3 className="font-serif text-lg font-semibold">{title}</h3>
      <p className="mb-3 text-xs text-faint">{hint}</p>
      {shown.length === 0 ? (
        <p className="text-sm text-faint">None identified.</p>
      ) : (
        <ul className="flex flex-col gap-4 text-sm">
          {shown.map(({ claim, assessment, index }) => (
            <Claim key={index} claim={claim} assessment={assessment} lookup={lookup} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AnalysisTab({ result, lookup }: { result: ResearchPreviewResult; lookup: Lookup }) {
  const analysis = result.analysis;
  const review = result.verification.claims;
  if (analysis.status === "skipped") return <Empty>No verified evidence was extracted, so there is nothing to analyse. See the steps on the left for why.</Empty>;
  if (analysis.status === "failed") return <Empty>The analysis step failed: {analysis.message} The Studies and Metrics tabs are still available.</Empty>;
  return (
    <div className="flex flex-col gap-8">
      <p className="rounded-lg bg-sunken px-3 py-2 text-xs text-muted">
        {review.status === "assessed"
          ? `Each claim was reviewed by ${review.model} against the quotes it cites; unsupported claims are omitted. The same model wrote and reviewed the claims, so treat the review as a check, not independent confirmation.`
          : review.status === "failed"
            ? `Claim review failed (${review.message}) — claims below have not been checked against their quotes.`
            : "No claims to review."}
      </p>
      <Section section="findings" title="Findings" hint="Main results relevant to the question." claims={analysis.findings} lookup={lookup} />
      <Section section="agreements" title="Agreements" hint="Results supported by two or more papers." claims={analysis.agreements} lookup={lookup} />
      <Section section="conflicts" title="Conflicts" hint="Results that diverge across papers." claims={analysis.conflicts} lookup={lookup} />
      <Section section="gaps" title="Evidence gaps" hint="What this evidence does not establish." claims={analysis.gaps} lookup={lookup} />
    </div>
  );
}

function StudiesTab({ result, lookup }: { result: ResearchPreviewResult; lookup: Lookup }) {
  const studies = result.analysis.status === "skipped" ? [] : result.analysis.studies;
  if (studies.length === 0) return <Empty>No studies were extracted.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
        <thead className="text-xs text-faint">
          <tr className="border-b border-line">
            {["Study", "Design", "N", "Dataset", "Methods", "Reported metrics"].map((h) => (
              <th key={h} className="px-2 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {studies.map((s) => {
            const paper = lookup.papers.get(s.paperId);
            return (
              <tr key={s.paperId} className="border-b border-line align-top">
                <td className="px-2 py-2">
                  <p className="font-medium">{s.label}</p>
                  {lookup.checks.get(s.paperId)?.retracted && <Badge tone="bad">Retracted</Badge>}
                  {paper && <ExternalLinks paper={paper} />}
                </td>
                <td className="px-2 py-2">{s.design ? humanize(s.design) : <Dash />}</td>
                <td className="px-2 py-2 tabular-nums">{s.sampleSize !== undefined ? formatNumber(s.sampleSize) : <Dash />}</td>
                <td className="px-2 py-2">{s.dataset ?? <Dash />}</td>
                <td className="px-2 py-2">{s.methods.length ? s.methods.join(", ") : <Dash />}</td>
                <td className="px-2 py-2">
                  {s.metrics.length ? (
                    <ul>
                      {s.metrics.map((m, i) => (
                        <li key={i}>
                          {m.name}: <span className="tabular-nums">{m.value}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Dash />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MetricsTab({ result, lookup }: { result: ResearchPreviewResult; lookup: Lookup }) {
  const metrics = result.analysis.status === "skipped" ? [] : result.analysis.metrics;
  if (metrics.length === 0) return <Empty>No quantitative metrics were extracted.</Empty>;
  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
        Values are grouped by metric name only. Studies may measure different outcomes, populations or horizons, so compare them only after reading
        the evidence.
      </p>
      {metrics.map((group) => (
        <section key={group.metric}>
          <h3 className="mb-2 font-medium">{group.metric}</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {group.entries.map((entry, i) => {
              const paper = lookup.papers.get(entry.paperId);
              const item = lookup.evidence.get(entry.evidenceId);
              return (
                <li key={i} className="flex flex-col gap-1 rounded-lg border border-line p-3">
                  <p className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{paper ? studyLabel(paper) : entry.paperId}</span>
                    <span className="tabular-nums">{entry.value}</span>
                  </p>
                  {item && <p className="text-xs text-muted">“{item.quote}”</p>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

const FIELD_ORDER: Array<keyof PaperExtraction> = ["objective", "studyDesign", "population", "sampleSize", "dataset", "methods", "findings", "limitations"];

function ExtractionDetail({ extraction }: { extraction: PaperExtraction }) {
  const rows = FIELD_ORDER.flatMap((field) => {
    const value = extraction[field];
    const items = Array.isArray(value) ? value : value ? [value] : [];
    return items.map((item, i) => {
      const text = "category" in item ? humanize(item.category) : typeof item.value === "number" ? formatNumber(item.value) : item.value;
      return { key: `${field}${i}`, field, text, quote: item.quote };
    });
  });
  if (rows.length === 0) return <p className="text-xs text-faint">No items passed verification.</p>;
  return (
    <dl className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.key}>
          <dt className="text-xs text-faint">{humanize(r.field)}</dt>
          <dd>
            {r.text}
            <blockquote className="mt-0.5 border-l-2 border-line pl-2 text-xs text-muted">“{r.quote}”</blockquote>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PaperCard({
  paper,
  rank,
  extraction,
  check,
}: {
  paper: RankedPaper;
  rank: number;
  extraction: ExtractionResult | undefined;
  check: PaperCheck | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl border border-line p-4">
      <p className="flex items-start gap-3">
        <span className="mt-0.5 font-mono text-xs text-faint">#{rank}</span>
        <span className="flex-1">
          <span className="block font-medium leading-snug">{paper.title}</span>
          <span className="mt-1 block text-xs text-muted">
            {shortAuthors(paper.authors)} · {[paper.journal, paper.year].filter(Boolean).join(", ")}
          </span>
        </span>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-7">
        <ExternalLinks paper={paper} />
        <RecordBadges check={check} />
        {paper.sources.map((s) => (
          <Badge key={s}>{s === "pubmed" ? "PubMed" : "Europe PMC"}</Badge>
        ))}
        {check?.preprint && <Badge tone="warn">Preprint · not peer reviewed</Badge>}
        <span className="text-xs text-faint" title="Reciprocal-rank-fusion score">
          relevance {paper.relevance.score.toFixed(3)}
        </span>
        <button type="button" onClick={() => setOpen((o) => !o)} className="ml-auto text-xs text-accent hover:underline" aria-expanded={open}>
          {open ? "Hide details" : "Abstract & extraction"}
        </button>
      </div>
      {open && (
        <div className="mt-4 grid gap-4 pl-7 text-sm">
          <div>
            <h4 className="mb-1 text-xs font-medium text-faint">Abstract</h4>
            <p className="whitespace-pre-line text-muted">{paper.abstract ?? "No abstract available."}</p>
          </div>
          <div>
            <h4 className="mb-1 text-xs font-medium text-faint">Verified extraction</h4>
            {extraction?.status === "extracted" ? (
              <ExtractionDetail extraction={extraction.extraction} />
            ) : (
              <p className="text-xs text-faint">{extraction?.status === "failed" ? extraction.message : "Not extracted."}</p>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function PapersTab({ result, lookup }: { result: ResearchPreviewResult; lookup: Lookup }) {
  const byId = new Map(result.extractions.map((e) => [e.paperId, e]));
  return (
    <ul className="flex flex-col gap-3">
      {result.papers.map((p, i) => (
        <PaperCard key={p.id} paper={p} rank={i + 1} extraction={byId.get(p.id)} check={lookup.checks.get(p.id)} />
      ))}
    </ul>
  );
}

const Dash = () => <span className="text-faint">—</span>;
const Empty = ({ children }: { children: ReactNode }) => <p className="rounded-lg bg-sunken px-4 py-6 text-center text-sm text-muted">{children}</p>;

export function ReportPanel({ result, query }: { result: ResearchPreviewResult; query: string }) {
  const [tab, setTab] = useState<Tab>("analysis");
  const lookup = useMemo<Lookup>(
    () => ({
      evidence: new Map(result.analysis.status === "skipped" ? [] : result.analysis.evidence.map((e) => [e.id, e])),
      papers: new Map(result.papers.map((p) => [p.id, p])),
      checks: new Map(result.verification.papers.map((c) => [c.paperId, c])),
      assessments: new Map(
        result.verification.claims.status === "assessed" ? result.verification.claims.assessments.map((a) => [`${a.section}:${a.index}`, a]) : [],
      ),
    }),
    [result],
  );
  const retracted = result.verification.papers.filter((c) => c.retracted).length;

  return (
    // min-w-0 lets wide tables scroll inside the panel instead of stretching it past the viewport.
    <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl bg-surface">
      <header className="border-b border-line px-6 pt-5">
        <p className="flex items-center gap-2 text-xs text-faint">
          <Icon name="doc" /> Research report · preview
        </p>
        <h2 className="mt-1 font-serif text-xl font-semibold leading-snug">{query}</h2>
        <p className="mt-2 text-xs text-muted">
          Generated from {result.papers.length} abstracts. Research support only, not medical advice. Verify findings against the full papers.
        </p>
        {retracted > 0 && (
          <p role="alert" className="mt-2 flex items-center gap-2 rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad">
            <Icon name="alert" /> {retracted === 1 ? "One paper in this report is" : `${retracted} papers in this report are`} marked as retracted. Do
            not rely on {retracted === 1 ? "its" : "their"} findings.
          </p>
        )}
        <nav className="mt-4 flex gap-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${tab === t.id ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {tab === "analysis" && <AnalysisTab result={result} lookup={lookup} />}
        {tab === "studies" && <StudiesTab result={result} lookup={lookup} />}
        {tab === "metrics" && <MetricsTab result={result} lookup={lookup} />}
        {tab === "papers" && <PapersTab result={result} lookup={lookup} />}
      </div>
    </section>
  );
}
