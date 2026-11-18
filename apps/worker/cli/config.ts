import { parseArgs } from "node:util";
import { LlmProvider } from "@synthora/schemas";
import { ApiKey } from "../src/providers/index.js";

/**
 * The environment variable each provider's key is read from. These match the
 * credential names of OpenShell's provider profiles, so inside a sandbox the
 * variable holds an opaque placeholder and the real key is swapped in by the
 * sandbox proxy on the way out. Outside a sandbox it holds the key itself.
 */
export const KEY_ENV: Record<LlmProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

export interface CliConfig {
  query: string;
  provider: LlmProvider;
  model: string;
  topN: number;
  planner: boolean;
  outDir?: string | undefined;
  key: ApiKey;
}

export const USAGE = `Usage: synthora-research "<question>" --provider <anthropic|openai|gemini> --model <model> [--top 5] [--no-planner] [--out <dir>]

The key is read from ${Object.values(KEY_ENV).join(", ")} (matching --provider).
The report is printed to stdout as Markdown; progress goes to stderr.`;

export class CliError extends Error {}

export function parseCli(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): CliConfig {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      provider: { type: "string" },
      model: { type: "string" },
      top: { type: "string", default: "5" },
      "no-planner": { type: "boolean", default: false },
      out: { type: "string" },
    },
  });

  const query = positionals.join(" ").trim();
  if (query.length < 3) throw new CliError("Give a research question.");
  if (query.length > 500) throw new CliError("The question is longer than 500 characters.");

  const provider = LlmProvider.safeParse(values.provider);
  if (!provider.success) throw new CliError("Pass --provider anthropic, openai or gemini.");
  if (!values.model) throw new CliError("Pass --model.");

  const topN = Number(values.top);
  if (!Number.isInteger(topN) || topN < 1 || topN > 10) throw new CliError("--top must be a whole number from 1 to 10.");

  const envName = KEY_ENV[provider.data];
  const key = ApiKey.parse(env[envName]);
  if (!key) throw new CliError(`Set ${envName} to your ${provider.data} key (or attach an OpenShell provider that supplies it).`);

  return { query, provider: provider.data, model: values.model, topN, planner: !values["no-planner"], outDir: values.out, key };
}
