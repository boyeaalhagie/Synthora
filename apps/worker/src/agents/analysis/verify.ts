import type { AnalysisDraft, AnalysisSection, Claim, EvidenceItem, RejectedClaim, VerifiedClaim } from "@synthora/schemas";

/** Sections whose claims compare papers, and so must cite at least two different ones. */
const MULTI_PAPER_SECTIONS = new Set<AnalysisSection>(["agreements", "conflicts"]);

/** "[e12]" / " E12 " -> "E12". */
function normalizeId(id: string): string {
  return id.trim().replace(/^\[|\]$/g, "").toUpperCase();
}

export type VerifiedSections = Record<AnalysisSection, VerifiedClaim[]>;

/**
 * Checks every claim's citations. A claim is rejected outright if it cites an
 * id that does not exist (a sign of fabrication), and comparison claims are
 * rejected unless they draw on at least two different papers.
 *
 * This establishes that citations are real and structurally sufficient. It
 * does not establish that the cited evidence supports the statement; that is
 * the citation-verification stage.
 */
export function verifyClaims(
  draft: AnalysisDraft,
  evidence: readonly EvidenceItem[],
): { sections: VerifiedSections; rejected: RejectedClaim[] } {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const rejected: RejectedClaim[] = [];

  const check = (section: AnalysisSection, claims: Claim[]): VerifiedClaim[] =>
    claims.flatMap((claim) => {
      const ids = [...new Set(claim.evidence.map(normalizeId))];
      const items = ids.map((id) => byId.get(id));
      if (items.some((item) => item === undefined)) {
        rejected.push({ section, claim, reason: "unknown_evidence" });
        return [];
      }
      const paperIds = [...new Set(items.map((item) => item!.paperId))];
      if (MULTI_PAPER_SECTIONS.has(section) && paperIds.length < 2) {
        rejected.push({ section, claim, reason: "needs_multiple_papers" });
        return [];
      }
      return [{ statement: claim.statement, evidence: ids, paperIds }];
    });

  return {
    sections: {
      findings: check("findings", draft.findings),
      agreements: check("agreements", draft.agreements),
      conflicts: check("conflicts", draft.conflicts),
      gaps: check("gaps", draft.gaps),
    },
    rejected,
  };
}
