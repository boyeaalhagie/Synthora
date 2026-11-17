import type { ClaimAssessment, EvidenceItem, PaperCheck, RankedPaper, StudySummary } from "@synthora/schemas";
import { formatNumber, humanize, paperLinks, studyLabel } from "../lib/format.js";
import { Badge, Icon } from "./ui.js";

/** Indexes over one research result, shared by every report view. */
export interface Lookup {
  evidence: Map<string, EvidenceItem>;
  papers: Map<string, RankedPaper>;
  checks: Map<string, PaperCheck>;
  /** "findings:0" -> the reviewer's verdict on that claim. */
  assessments: Map<string, ClaimAssessment>;
}

export function ExternalLinks({ paper }: { paper: RankedPaper }) {
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

export function EvidenceCard({ item, lookup }: { item: EvidenceItem; lookup: Lookup }) {
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

const Dash = () => <span className="text-faint">—</span>;

/** Side-by-side study characteristics. `refNumbers` adds [n] reference marks when shown inside the written report. */
export function StudyTable({ studies, lookup, refNumbers }: { studies: readonly StudySummary[]; lookup: Lookup; refNumbers?: ReadonlyMap<string, number> }) {
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
            const ref = refNumbers?.get(s.paperId);
            return (
              <tr key={s.paperId} className="border-b border-line align-top">
                <td className="px-2 py-2">
                  <p className="font-medium">
                    {s.label}
                    {ref !== undefined && <span className="ml-1 text-xs text-faint">[{ref}]</span>}
                  </p>
                  {lookup.checks.get(s.paperId)?.retracted && <Badge tone="bad">Retracted</Badge>}
                  {paper && !refNumbers && <ExternalLinks paper={paper} />}
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
