const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1] === "x" || entity[1] === "X";
      const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

// Block-level tags become a space; inline tags (<i>, <sub>, …) vanish so "H<sub>2</sub>O" stays "H2O".
const BLOCK_TAG = /<\/?(?:p|br|div|h[1-6]|li|ul|ol|table|tr|td|th)\b[^>]*>/gi;
const ANY_TAG = /<[^>]*>/g;

/** Converts an HTML/XML fragment to plain text. Entities are decoded after tags are removed. */
export function stripMarkup(input: string): string {
  return normalizeWhitespace(decodeEntities(input.replace(BLOCK_TAG, " ").replace(ANY_TAG, "")));
}

/** Returns the trimmed string, or `undefined` when empty. */
export function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseYear(raw: string | number | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const match = /\b(1[89]\d{2}|2[01]\d{2})\b/.exec(String(raw));
  return match ? Number(match[1]) : undefined;
}
