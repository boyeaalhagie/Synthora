import type { Paper } from "@synthora/schemas";

export const formatNumber = (n: number) => n.toLocaleString("en-US");

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** "study_design" / "studyDesign" -> "Study design". */
export function humanize(value: string): string {
  const text = value
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Oikonomou EK, Khera R, et al." */
export function shortAuthors(authors: readonly string[]): string {
  if (authors.length === 0) return "Unknown authors";
  return authors.length > 2 ? `${authors.slice(0, 2).join(", ")}, et al.` : authors.join(", ");
}

/** "Oikonomou 2023", matching the server's study labels. */
export function studyLabel(paper: Paper): string {
  const surname = paper.authors[0]?.split(/\s+/)[0];
  return [surname, paper.year].filter((p) => p !== undefined && p !== "").join(" ") || paper.id;
}

export interface PaperLink {
  label: string;
  href: string;
}

/** Links built only from identifiers the source APIs returned. */
export function paperLinks(paper: Paper): PaperLink[] {
  const links: PaperLink[] = [];
  if (paper.pmid) links.push({ label: "PubMed", href: `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/` });
  if (paper.pmcid) links.push({ label: "PMC", href: `https://www.ncbi.nlm.nih.gov/pmc/articles/${paper.pmcid}/` });
  if (paper.doi) links.push({ label: "DOI", href: `https://doi.org/${paper.doi}` });
  return links;
}
