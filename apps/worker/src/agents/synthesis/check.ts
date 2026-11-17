import type { DraftSentence, EvidenceItem, ReportSectionId, RejectedSentence } from "@synthora/schemas";

const NUMBER = /\d+(?:[.,]\d+)*/g;

/**
 * Canonical form of a number token so "12,345" and "12345", or "0.80" and
 * "0.8", compare equal. A comma followed by exactly three digits is a
 * thousands separator; any other comma is a decimal mark.
 */
export function normalizeNumber(raw: string): string {
  const plain = /^\d{1,3}(,\d{3})+$/.test(raw) ? raw.replaceAll(",", "") : raw.replaceAll(",", ".");
  const value = Number(plain);
  return Number.isFinite(value) ? String(value) : plain;
}

export function numbersIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map(normalizeNumber);
}

/** Small counts ("2 studies", "10-year") are prose, not statistics, so they are not checked. */
const MAX_UNCHECKED_INTEGER = 10;

/** Removes citation markup the model may echo ("E12", "[3]") so its digits are not mistaken for data. */
function stripCitationMarkup(text: string): string {
  return text.replace(/\bE\d+\b/g, " ").replace(/\[\d+(?:\s*[,–-]\s*\d+)*\]/g, " ");
}

export interface CheckContext {
  evidence: ReadonlyMap<string, EvidenceItem>;
  /** Publication years of each paper, so "Smith 2023" does not count as an unsupported number. */
  paperYears: ReadonlyMap<string, number>;
}

export type SentenceCheck = { ok: true; evidence: string[] } | { ok: false; reason: RejectedSentence["reason"]; detail?: string };

/**
 * Checks one model-written sentence:
 * - it must cite at least one evidence id, and every id must exist;
 * - every number in it must appear in the evidence it cites (except small
 *   counts and the cited papers' publication years).
 *
 * The number check catches invented or mis-transcribed statistics, the
 * most damaging error in a research summary, without a second model call.
 */
export function checkSentence(sentence: DraftSentence, ctx: CheckContext): SentenceCheck {
  const ids = [...new Set(sentence.evidence.map((id) => id.trim().replace(/^\[|\]$/g, "").toUpperCase()))];
  if (ids.length === 0) return { ok: false, reason: "no_evidence" };
  const items = ids.map((id) => ctx.evidence.get(id));
  if (items.some((i) => i === undefined)) return { ok: false, reason: "unknown_evidence" };

  const available = new Set<string>();
  const years = new Set<string>();
  for (const item of items as EvidenceItem[]) {
    for (const n of numbersIn(`${item.quote} ${item.value}`)) available.add(n);
    const year = ctx.paperYears.get(item.paperId);
    if (year !== undefined) years.add(String(year));
  }

  const missing = numbersIn(stripCitationMarkup(sentence.text)).filter((n) => {
    const value = Number(n);
    if (Number.isInteger(value) && value <= MAX_UNCHECKED_INTEGER) return false;
    return !available.has(n) && !years.has(n);
  });
  if (missing.length > 0) return { ok: false, reason: "number_not_in_evidence", detail: [...new Set(missing)].join(", ") };

  return { ok: true, evidence: ids };
}

export function checkParagraphs(
  section: ReportSectionId,
  paragraphs: DraftSentence[][],
  ctx: CheckContext,
  rejected: RejectedSentence[],
): Array<Array<{ text: string; evidence: string[] }>> {
  return paragraphs
    .map((paragraph) =>
      paragraph.flatMap((sentence) => {
        const result = checkSentence(sentence, ctx);
        if (result.ok) return [{ text: sentence.text, evidence: result.evidence }];
        rejected.push({ section, sentence, reason: result.reason, ...(result.detail && { detail: result.detail }) });
        return [];
      }),
    )
    .filter((paragraph) => paragraph.length > 0);
}
