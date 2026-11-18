# 0003: NVIDIA OpenShell runs a sandboxed copy of the pipeline, beside the hosted app

Date: 2026-11-17 · Status: accepted

## Context

The blueprint proposes NVIDIA OpenShell (Apache-2.0) as a security layer for Synthora's agents: sandboxing, per-agent permissions, network controls, credential brokering and audit logs.

OpenShell runs sandboxes on a Linux host with Docker or Podman. It needs Landlock (kernel 6.2+) and seccomp. The hosted app runs on Cloudflare Workers, which cannot host OpenShell.

Synthora's agents do not execute code, run shell commands or read local files. They call five HTTPS services: PubMed, Europe PMC, Crossref and the user's chosen model provider. The real risk is that text from a paper abstract (untrusted input) steers a model step. Code already checks every model output before it is used. A sandbox adds a second, independent guarantee: whatever a model says, the process can only reach those five hosts. It also never holds the real key.

## Options considered

1. **Put an OpenShell gateway in front of the hosted Worker.** Every model call would go from the Worker to a separate always-on server and on to the provider. User keys would pass through that extra hop. This weakens the "keys are never stored, minimal hops" design in [0002](0002-no-durable-workflows-with-byok.md) and adds a server to run and secure. Rejected.
2. **A per-agent sandbox for each of the six agents.** Their network needs are almost identical: all need the model provider, and the search and verification steps need the literature APIs. Six sandboxes would add process boundaries without meaningfully tighter rules. Rejected for now.
3. **Run the same pipeline as a command-line program inside one OpenShell sandbox, beside the hosted app.** Chosen.

## Decision

- `apps/worker/cli/research.ts` runs the unchanged pipeline under Node. It reads the key from `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GEMINI_API_KEY`. These are the names OpenShell's provider profiles use.
- `sandbox/openshell/Dockerfile` builds one bundled file on the official Node image. Only `/usr/local/bin/node` ever needs the network.
- `sandbox/openshell/policy.yaml` is default deny. It allows `node` to make only the literature requests Synthora sends (PubMed search and record fetch, Europe PMC search, Crossref lookups) and to reach the provider hosts, all with `enforcement: enforce`. The filesystem is read-only apart from `/tmp`, and the process runs as a non-root user.
- The key is attached as an OpenShell **provider**. The sandbox sees only a placeholder (`openshell:resolve:env:…`), which the proxy replaces on requests to the provider's own endpoints.
- `test/openshell-policy.test.ts` fails if the code starts calling a host the policy does not allow, or if a rule drops to `audit` mode.

## Consequences

- People who want stronger isolation, such as institutions handling sensitive questions, can run Synthora on their own Linux host with enforced egress and an audit trail (`openshell logs`).
- The hosted app is unchanged and does not depend on OpenShell.
- OpenShell is pre-1.0 (v0.1.x), and Windows support (WSL 2 with Docker Desktop) is experimental. The policy has been run against a live 0.1.9 gateway on WSL 2. See `sandbox/openshell/README.md` for what is verified.
