import { Doi, Pmcid, Pmid } from "@synthora/schemas";

/**
 * Identifier normalisation. Each function returns `undefined` for anything
 * that is not a well-formed identifier, so malformed source data is dropped
 * rather than propagated into citations.
 */

export function normalizePmid(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value && Pmid.safeParse(value).success ? value : undefined;
}

export function normalizePmcid(raw: string | undefined): string | undefined {
  let value = raw?.trim().toUpperCase();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) value = `PMC${value}`;
  return Pmcid.safeParse(value).success ? value : undefined;
}

export function normalizeDoi(raw: string | undefined): string | undefined {
  const value = raw
    ?.trim()
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
  return value && Doi.safeParse(value).success ? value : undefined;
}
