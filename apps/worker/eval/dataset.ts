import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

const Grade = z.union([z.literal(0), z.literal(1), z.literal(2)]);

export const EvalQuestion = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  question: z.string().min(10),
  /**
   * Relevance judgments keyed by Synthora paper id ("pmid:123", "doi:…").
   * 0 not relevant, 1 partially relevant, 2 highly relevant.
   */
  judgments: z.record(z.string(), Grade),
  /** Candidate papers awaiting a judgment, with enough context to judge them. */
  pending: z
    .array(z.object({ id: z.string(), title: z.string(), year: z.number().optional(), snippet: z.string().optional() }))
    .default([]),
  /** Who produced the judgments, so readers know how far to trust them. */
  labelledBy: z.string(),
  notes: z.string().optional(),
});
export type EvalQuestion = z.infer<typeof EvalQuestion>;

export const EvalDataset = z.object({
  name: z.string(),
  description: z.string(),
  questions: z.array(EvalQuestion).min(1),
});
export type EvalDataset = z.infer<typeof EvalDataset>;

export function loadDataset(path: string): EvalDataset {
  return EvalDataset.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function saveDataset(path: string, dataset: EvalDataset): void {
  writeFileSync(path, `${JSON.stringify(EvalDataset.parse(dataset), null, 2)}\n`);
}
