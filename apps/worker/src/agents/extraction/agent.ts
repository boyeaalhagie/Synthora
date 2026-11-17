import { PaperExtraction, type ExtractionResult, type Paper } from "@synthora/schemas";
import type { ProviderAdapter } from "../../providers/index.js";
import { FATAL_PROVIDER_ERRORS, generateStructured, parseStructured } from "../structured.js";
import { extractionPrompt, PROMPT_VERSION, repairPrompt, sourceTextOf, SYSTEM_PROMPT } from "./prompt.js";
import { verifyExtraction } from "./verify.js";

export interface ExtractOptions {
  model: string;
  /** Includes any thinking tokens on reasoning models. */
  maxOutputTokens?: number;
  /** Total model calls per paper, including one repair attempt by default. */
  maxAttempts?: number;
}

export interface ExtractManyOptions extends ExtractOptions {
  /** Papers processed in parallel. Kept low because it spends the user's rate limit. */
  concurrency?: number;
}

const DEFAULTS = { maxOutputTokens: 8_000, maxAttempts: 2, concurrency: 3 };

/** Parses model output into a PaperExtraction. */
export function parseExtraction(text: string) {
  return parseStructured(text, PaperExtraction);
}

/**
 * Extracts one paper: prompt, parse and validate (with one repair attempt by
 * default), then verify every quote against the source text. Never throws;
 * failures are returned with the tokens they consumed.
 */
export async function extractPaper(
  paper: Paper,
  adapter: ProviderAdapter,
  options: ExtractOptions,
): Promise<ExtractionResult> {
  if (!paper.abstract) return { status: "skipped", paperId: paper.id, reason: "no_abstract" };

  const outcome = await generateStructured(adapter, {
    model: options.model,
    system: SYSTEM_PROMPT,
    prompt: extractionPrompt(paper),
    schema: PaperExtraction,
    maxOutputTokens: options.maxOutputTokens ?? DEFAULTS.maxOutputTokens,
    maxAttempts: options.maxAttempts ?? DEFAULTS.maxAttempts,
    repairPrompt: (previous, problems) => repairPrompt(paper, previous, problems),
  });

  if (!outcome.ok) {
    const { ok: _ok, ...failure } = outcome;
    return { status: "failed", paperId: paper.id, ...failure };
  }

  const { verified, rejected } = verifyExtraction(outcome.value, sourceTextOf(paper));
  return {
    status: "extracted",
    paperId: paper.id,
    extraction: verified,
    rejected,
    model: outcome.model,
    promptVersion: PROMPT_VERSION,
    attempts: outcome.attempts,
    usage: outcome.usage,
  };
}

/**
 * Extracts many papers with bounded concurrency. Results keep the input order.
 * If the provider rejects the key or model, remaining papers are not sent.
 */
export async function extractPapers(
  papers: readonly Paper[],
  adapter: ProviderAdapter,
  options: ExtractManyOptions,
): Promise<ExtractionResult[]> {
  const results: ExtractionResult[] = new Array(papers.length);
  let next = 0;
  let fatal: ExtractionResult | undefined;

  const worker = async () => {
    while (next < papers.length) {
      const index = next++;
      const paper = papers[index]!;
      if (fatal?.status === "failed") {
        results[index] = { ...fatal, paperId: paper.id, attempts: 0, usage: { inputTokens: 0, outputTokens: 0 } };
        continue;
      }
      const result = await extractPaper(paper, adapter, options);
      if (result.status === "failed" && result.providerErrorKind && FATAL_PROVIDER_ERRORS.has(result.providerErrorKind)) {
        fatal ??= result;
      }
      results[index] = result;
    }
  };

  const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULTS.concurrency, papers.length));
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
