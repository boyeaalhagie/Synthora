import type { PlanConcept, PlanDraft, SearchQueries } from "@synthora/schemas";

const BOOLEAN_WORDS = /\b(?:AND|OR|NOT)\b/g;

/**
 * Reduces a planner term to plain words: removes quotes, brackets, field tags,
 * wildcards and boolean operators, so a term can never alter query structure.
 */
export function cleanTerm(term: string): string {
  return term
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^\p{L}\p{N}\s\-'/.+]/gu, " ")
    .replace(BOOLEAN_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanConcepts(concepts: readonly PlanConcept[]): string[][] {
  return concepts
    .map((c) => [...new Set(c.terms.map(cleanTerm).filter((t) => t.length >= 2))])
    .filter((terms) => terms.length > 0);
}

/**
 * PubMed: each concept is an OR of title/abstract phrase searches, and the
 * concepts are ANDed. `[tiab]` keeps matches to titles and abstracts, which is
 * also what the extraction step reads.
 */
export function pubmedQuery(plan: PlanDraft): string {
  const groups = cleanConcepts(plan.concepts).map((terms) => `(${terms.map((t) => `"${t}"[tiab]`).join(" OR ")})`);
  if (plan.yearFrom !== null || plan.yearTo !== null) {
    groups.push(`("${plan.yearFrom ?? 1900}"[dp] : "${plan.yearTo ?? 3000}"[dp])`);
  }
  return groups.join(" AND ");
}

/** Europe PMC: the same structure in its syntax, with PUB_YEAR for the date range. */
export function europePmcQuery(plan: PlanDraft): string {
  const groups = cleanConcepts(plan.concepts).map((terms) => `(${terms.map((t) => `"${t}"`).join(" OR ")})`);
  if (plan.yearFrom !== null || plan.yearTo !== null) {
    groups.push(`PUB_YEAR:[${plan.yearFrom ?? 1900} TO ${plan.yearTo ?? 3000}]`);
  }
  return groups.join(" AND ");
}

export function buildQueries(question: string, plan: PlanDraft): SearchQueries {
  const terms = cleanConcepts(plan.concepts).flat();
  return {
    pubmed: pubmedQuery(plan),
    europepmc: europePmcQuery(plan),
    // The question plus every planned term, so lexical ranking rewards papers that use the synonyms too.
    ranking: [question, ...terms].join(" "),
  };
}

/** Used when planning is unavailable: every source gets the question as written. */
export function fallbackQueries(question: string): SearchQueries {
  return { pubmed: question, europepmc: question, ranking: question };
}
