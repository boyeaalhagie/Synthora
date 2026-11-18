import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CliError, KEY_ENV, parseCli } from "../cli/config.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const policy = readFileSync(join(ROOT, "sandbox/openshell/policy.yaml"), "utf8");
const policyHosts = [...policy.matchAll(/^\s*- host: (\S+)\s*$/gm)].map((m) => m[1]);

function sourceHosts(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .flatMap((f) => [...readFileSync(join(dir, f), "utf8").matchAll(/"https:\/\/([a-z0-9.-]+)\//g)].map((m) => m[1]!));
}

describe("OpenShell policy", () => {
  it("allows every literature host the code calls", () => {
    const hosts = sourceHosts(join(ROOT, "apps/worker/src/literature"));
    expect(hosts.length).toBeGreaterThanOrEqual(3);
    for (const host of hosts) expect(policyHosts).toContain(host);
  });

  it("allows each provider's API host", () => {
    for (const host of ["api.anthropic.com", "api.openai.com", "generativelanguage.googleapis.com"]) expect(policyHosts).toContain(host);
  });

  it("enforces every rule instead of only auditing", () => {
    const enforced = policy.match(/^\s*enforcement: enforce\s*$/gm) ?? [];
    expect(enforced.length).toBe(policyHosts.length);
    expect(policy).not.toMatch(/enforcement: audit/);
  });

  it("lets only the Node runtime connect", () => {
    const binaries = [...policy.matchAll(/^\s*- path: (\S+)\s*$/gm)].map((m) => m[1]);
    expect(new Set(binaries)).toEqual(new Set(["/usr/local/bin/node"]));
  });
});

describe("research CLI arguments", () => {
  const key = "sk-test-0123456789abcdefghij";
  const args = ["Does", "metformin", "reduce", "cancer", "risk?", "--provider", "anthropic", "--model", "m"];

  it("reads the key from the provider's own variable", () => {
    const config = parseCli(args, { [KEY_ENV.anthropic]: key });
    expect(config.query).toBe("Does metformin reduce cancer risk?");
    expect(config.key.reveal()).toBe(key);
    expect(config).toMatchObject({ provider: "anthropic", model: "m", topN: 5, planner: true });
  });

  it("accepts an OpenShell credential placeholder as the key", () => {
    const config = parseCli(args, { ANTHROPIC_API_KEY: "openshell:resolve:env:ANTHROPIC_API_KEY" });
    expect(config.key.reveal()).toBe("openshell:resolve:env:ANTHROPIC_API_KEY");
  });

  it("does not use another provider's key", () => {
    expect(() => parseCli(args, { OPENAI_API_KEY: key })).toThrow(CliError);
  });

  it("rejects missing options and out-of-range values", () => {
    expect(() => parseCli(["question here", "--model", "m"], { ANTHROPIC_API_KEY: key })).toThrow(/--provider/);
    expect(() => parseCli([...args, "--top", "50"], { ANTHROPIC_API_KEY: key })).toThrow(/--top/);
    expect(() => parseCli(["--provider", "anthropic", "--model", "m"], { ANTHROPIC_API_KEY: key })).toThrow(/question/);
  });

  it("can turn the planner off", () => {
    expect(parseCli([...args, "--no-planner"], { ANTHROPIC_API_KEY: key }).planner).toBe(false);
  });
});
