# 0001 — Orchestration in TypeScript on Cloudflare Workers

Date: 2026-11-16 · Status: accepted

## Context

The blueprint proposes two approaches. Section 4 runs LangGraph as a separate Python service. Section 11 keeps orchestration in TypeScript on Workers.

## Decision

The whole production pipeline runs as TypeScript on Cloudflare Workers, with Workflows for durable multi-step execution. Python stays available for offline evaluation and experiments under `research/`.

## Consequences

- There is one deploy target and no always-on server, so user API keys never pass through an extra hop.
- Shared Zod schemas validate data at every agent boundary, which is the job Pydantic would do in Python.
- LangGraph is not used. The agent graph is small and fixed (six stages), so explicit Workflow steps are easier to test and reason about than a graph framework.
- NVIDIA OpenShell needs a Linux/Docker host, so it cannot run on Workers. It is used for a sandboxed command-line copy of the pipeline instead; see [0003](0003-openshell-sandboxed-runner.md).
