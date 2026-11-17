import type { Evidenced, Finding, PaperExtraction, RejectedItem } from "@synthora/schemas";

/** Quotes shorter than this (after normalisation) are too generic to prove anything. */
export const MIN_QUOTE_LENGTH = 8;

/**
 * Normalises text for quote matching: Unicode compatibility forms, case,
 * typographic quotes and dashes, and whitespace. Nothing else is forgiven —
 * a quote with changed words, reordered phrases or ellipses does not match.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `n` appears as a whole number in `text`, allowing thousands separators ("12,345"). */
export function containsNumber(text: string, n: number): boolean {
  const compact = text.replace(/(\d)[,   ](?=\d{3}(?!\d))/g, "$1");
  return new RegExp(`(?<![\\d.])${n}(?![\\d]|\\.\\d)`).test(compact);
}

type Check = "ok" | RejectedItem["reason"];

class SourceMatcher {
  private readonly source: string;

  constructor(sourceText: string) {
    this.source = normalizeForMatch(sourceText);
  }

  quote(quote: string): Check {
    const q = normalizeForMatch(quote);
    if (q.length < MIN_QUOTE_LENGTH) return "quote_too_short";
    return this.source.includes(q) ? "ok" : "quote_not_in_source";
  }
}

/**
 * Splits an extraction into items whose quotes are verified against the
 * source text and items that are rejected.
 *
 * This proves the quoted text exists in the paper. It does not prove the
 * paraphrased `value` faithfully represents the quote; that judgement
 * belongs to the citation-verification stage.
 */
export function verifyExtraction(
  extraction: PaperExtraction,
  sourceText: string,
): { verified: PaperExtraction; rejected: RejectedItem[] } {
  const matcher = new SourceMatcher(sourceText);
  const rejected: RejectedItem[] = [];

  const single = <T extends { quote: string }>(
    field: RejectedItem["field"],
    item: T | null,
    extra?: (item: T) => Check,
  ): T | null => {
    if (item === null) return null;
    const result = matcher.quote(item.quote);
    const check = result === "ok" && extra ? extra(item) : result;
    if (check === "ok") return item;
    rejected.push({ field, item, reason: check });
    return null;
  };

  const list = <T extends Evidenced>(field: RejectedItem["field"], items: T[], extra?: (item: T) => Check): T[] =>
    items.flatMap((item) => {
      const kept = single(field, item, extra);
      return kept === null ? [] : [kept];
    });

  const metricsInQuote = (finding: Finding): Check => {
    const quote = normalizeForMatch(finding.quote);
    return finding.metrics.every((m) => quote.includes(normalizeForMatch(m.value))) ? "ok" : "metric_not_in_quote";
  };

  const verified: PaperExtraction = {
    objective: single("objective", extraction.objective),
    studyDesign: single("studyDesign", extraction.studyDesign),
    population: single("population", extraction.population),
    sampleSize: single("sampleSize", extraction.sampleSize, (s) =>
      containsNumber(s.quote, s.value) ? "ok" : "value_not_in_quote",
    ),
    dataset: single("dataset", extraction.dataset),
    methods: list("methods", extraction.methods),
    findings: list("findings", extraction.findings, metricsInQuote),
    limitations: list("limitations", extraction.limitations),
  };

  return { verified, rejected };
}
