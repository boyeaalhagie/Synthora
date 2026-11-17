import type { ReportSection, ReportSentence, ResearchReport } from "@synthora/schemas";
import { Fragment, useState } from "react";
import { EvidenceCard, ExternalLinks, StudyTable, type Lookup } from "./report-shared.js";
import { Badge, Button, Icon } from "./ui.js";

type Written = Extract<ResearchReport, { status: "written" }>;

function downloadMarkdown(report: Written) {
  const blob = new Blob([report.markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `synthora-report-${report.generatedAt.slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

const citation = (s: ReportSentence) => (s.references.length ? `[${s.references.join(", ")}]` : "");

function Paragraph({ sentences, lookup }: { sentences: ReportSentence[]; lookup: Lookup }) {
  const [open, setOpen] = useState<number | null>(null);
  const openSentence = open === null ? undefined : sentences[open];
  return (
    <div className="flex flex-col gap-2">
      <p className="leading-relaxed">
        {sentences.map((s, i) => (
          <Fragment key={i}>
            <span className={open === i ? "rounded bg-chip" : undefined}>{s.text}</span>
            {s.references.length > 0 && (
              <button
                type="button"
                onClick={() => setOpen((current) => (current === i ? null : i))}
                aria-expanded={open === i}
                title="Show the evidence behind this sentence"
                className={`mx-0.5 rounded px-0.5 align-super text-[0.7rem] font-medium transition ${open === i ? "bg-accent text-accent-ink" : "text-accent hover:underline"}`}
              >
                {citation(s)}
              </button>
            )}{" "}
          </Fragment>
        ))}
      </p>
      {openSentence && (
        <div className="flex flex-col gap-2">
          {openSentence.evidence.map((id) => {
            const item = lookup.evidence.get(id);
            return item ? <EvidenceCard key={id} item={item} lookup={lookup} /> : null;
          })}
        </div>
      )}
    </div>
  );
}

function Section({ section, report, lookup, refNumbers }: { section: ReportSection; report: Written; lookup: Lookup; refNumbers: Map<string, number> }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 font-serif text-lg font-semibold">
        {section.title}
        {section.generated && (
          <span title="Composed by Synthora from what the pipeline actually did, not written by the model.">
            <Badge>from pipeline records</Badge>
          </span>
        )}
      </h2>
      {section.paragraphs.length === 0 ? (
        <p className="text-sm text-faint">No statements in this section passed verification.</p>
      ) : (
        section.paragraphs.map((p, i) => <Paragraph key={i} sentences={p} lookup={lookup} />)
      )}
      {section.id === "comparison" && report.studies.length > 0 && (
        <>
          <h3 className="mt-2 text-sm font-medium text-muted">Study characteristics</h3>
          <StudyTable studies={report.studies} lookup={lookup} refNumbers={refNumbers} />
        </>
      )}
    </section>
  );
}

export function ReportDocument({ report, lookup }: { report: ResearchReport; lookup: Lookup }) {
  if (report.status === "skipped") {
    return (
      <p className="rounded-lg bg-sunken px-4 py-6 text-center text-sm text-muted">
        {report.reason === "no_analysis"
          ? "No report was written because there was no verified evidence to analyse."
          : "No report was written because no claims survived review. See the Claims tab and the Verifier."}
      </p>
    );
  }
  if (report.status === "failed") {
    return (
      <p className="rounded-lg bg-bad-soft px-4 py-6 text-center text-sm text-bad">
        The report could not be written: {report.message} The Claims, Studies and Metrics tabs are still available.
      </p>
    );
  }

  const refNumbers = new Map(report.references.map((r) => [r.paperId, r.number]));
  return (
    <article className="flex flex-col gap-8 text-sm">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => downloadMarkdown(report)}>
            <Icon name="doc" /> Download Markdown
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            Print / Save as PDF
          </Button>
        </div>
        <h1 className="font-serif text-2xl font-semibold leading-snug">{report.title}</h1>
        <p className="text-xs text-muted">
          Written by {report.model} on {report.generatedAt.slice(0, 10)}. Every sentence cites its evidence — click a citation to read the quotes.
          {report.rejected.length > 0 && ` ${report.rejected.length} sentence${report.rejected.length === 1 ? " was" : "s were"} removed by verification (see the Verifier).`}
        </p>
      </header>

      {report.sections.map((section) => (
        <Section key={section.id} section={section} report={report} lookup={lookup} refNumbers={refNumbers} />
      ))}

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-lg font-semibold">References</h2>
        {report.references.length === 0 ? (
          <p className="text-faint">No references were cited.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {report.references.map((ref) => {
              const paper = lookup.papers.get(ref.paperId);
              return (
                <li key={ref.number} className="flex gap-2">
                  <span className="w-6 shrink-0 text-right tabular-nums text-faint">{ref.number}.</span>
                  <span>
                    {ref.citation} {paper && <ExternalLinks paper={paper} />}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </article>
  );
}

/** Plain, light-themed rendering used only when printing (see `.print-only` in index.css). */
export function PrintReport({ report }: { report: Written }) {
  return (
    <article className="mx-auto max-w-3xl bg-white p-8 font-serif text-[11pt] leading-relaxed text-black">
      <h1 className="text-2xl font-semibold">{report.title}</h1>
      <p className="mt-2">
        <strong>Research question:</strong> {report.question}
      </p>
      <p className="mt-1 text-xs italic">
        Generated by Synthora on {report.generatedAt.slice(0, 10)} with {report.model}. Research support only — not medical advice. Verify
        findings against the full papers.
      </p>
      {report.sections.map((section) => (
        <section key={section.id} className="mt-6 break-inside-avoid-page">
          <h2 className="text-lg font-semibold">{section.title}</h2>
          {section.paragraphs.length === 0 ? (
            <p className="mt-2 italic">No statements in this section passed verification.</p>
          ) : (
            section.paragraphs.map((p, i) => (
              <p key={i} className="mt-2">
                {p.map((s) => `${s.text}${s.references.length ? ` ${citation(s)}` : ""}`).join(" ")}
              </p>
            ))
          )}
          {section.id === "comparison" && report.studies.length > 0 && (
            <table className="mt-3 w-full border-collapse font-sans text-[9pt]">
              <thead>
                <tr>
                  {["Study", "Design", "N", "Dataset", "Methods", "Reported metrics"].map((h) => (
                    <th key={h} className="border-b border-black p-1 text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.studies.map((s) => (
                  <tr key={s.paperId} className="align-top">
                    <td className="border-b border-gray-300 p-1">{s.label}</td>
                    <td className="border-b border-gray-300 p-1">{s.design?.replaceAll("_", " ") ?? "—"}</td>
                    <td className="border-b border-gray-300 p-1">{s.sampleSize?.toLocaleString("en-US") ?? "—"}</td>
                    <td className="border-b border-gray-300 p-1">{s.dataset ?? "—"}</td>
                    <td className="border-b border-gray-300 p-1">{s.methods.join(", ") || "—"}</td>
                    <td className="border-b border-gray-300 p-1">{s.metrics.map((m) => `${m.name}: ${m.value}`).join("; ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
      <section className="mt-6">
        <h2 className="text-lg font-semibold">References</h2>
        <ol className="mt-2 list-decimal pl-6 text-[10pt]">
          {report.references.map((ref) => (
            <li key={ref.number}>{ref.citation}</li>
          ))}
        </ol>
      </section>
    </article>
  );
}
