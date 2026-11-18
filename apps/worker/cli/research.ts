/**
 * Run the full research pipeline from the command line, outside Cloudflare.
 *
 * This is the entry point used inside an NVIDIA OpenShell sandbox (see
 * sandbox/openshell). It runs the same pipeline as the hosted Worker. The only
 * difference is where it runs and what the network allows.
 *
 *   npm run research -- "Does metformin reduce cancer risk in type 2 diabetes?" --provider anthropic --model <model>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MinIntervalLimiter, type FetchFn } from "../src/lib/http.js";
import { CrossrefClient } from "../src/literature/crossref.js";
import { EuropePmcClient } from "../src/literature/europepmc.js";
import { PubMedClient } from "../src/literature/pubmed.js";
import { createAdapter } from "../src/providers/index.js";
import { runResearch, type PipelineDeps } from "../src/research/pipeline.js";
import { CliError, parseCli, USAGE } from "./config.js";

const log = (line: string) => process.stderr.write(`${line}\n`);

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    return argv.length === 0 ? 2 : 0;
  }
  let config;
  try {
    config = parseCli(argv, process.env);
  } catch (err) {
    if (err instanceof CliError || err instanceof TypeError) {
      log(`${err.message}\n\n${USAGE}`);
      return 2;
    }
    throw err;
  }

  const fetchFn: FetchFn = (input, init) => fetch(input, init);
  const ncbiKey = process.env.NCBI_API_KEY || undefined;
  const deps: PipelineDeps = {
    literatureClients: [
      new PubMedClient({ tool: "synthora", email: process.env.NCBI_EMAIL || undefined, apiKey: ncbiKey }, { fetch: fetchFn, limiter: new MinIntervalLimiter(ncbiKey ? 110 : 350) }),
      new EuropePmcClient({ fetch: fetchFn, limiter: new MinIntervalLimiter(100) }),
    ],
    createAdapter: (provider, key) => createAdapter(provider, key),
    crossref: new CrossrefClient({ mailto: process.env.CROSSREF_MAILTO || undefined }, { fetch: fetchFn, limiter: new MinIntervalLimiter(100) }),
  };

  let cancelled = false;
  process.once("SIGINT", () => {
    cancelled = true;
    log("Stopping after the current step…");
  });

  log(`Synthora · ${config.provider} · ${config.model}`);
  const outcome = await runResearch(
    { query: config.query, provider: config.provider, model: config.model, topN: config.topN, planner: config.planner },
    config.key,
    deps,
    {
      emit: (e) => {
        if (e.type === "step" && e.status !== "running") log(`  ${e.step}: ${e.status}${e.detail ? ` (${e.detail})` : ""}`);
        if (e.type === "extract") log(`  extract: ${e.completed}/${e.total}`);
      },
      isCancelled: () => cancelled,
    },
  );

  if (!outcome.ok) {
    log(`Failed: ${outcome.error}`);
    return 1;
  }

  const { result } = outcome;
  if (config.outDir) {
    mkdirSync(config.outDir, { recursive: true });
    writeFileSync(join(config.outDir, "result.json"), JSON.stringify(result, null, 2));
    if (result.report.status === "written") writeFileSync(join(config.outDir, "report.md"), result.report.markdown);
    log(`Saved to ${config.outDir}`);
  }

  if (result.report.status !== "written") {
    log(`No report was written (${result.report.status}: ${result.report.reason}).`);
    return 1;
  }
  process.stdout.write(result.report.markdown.endsWith("\n") ? result.report.markdown : `${result.report.markdown}\n`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    // Error messages from the provider SDKs never include the key: adapters only reveal it to the SDK client.
    log(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
