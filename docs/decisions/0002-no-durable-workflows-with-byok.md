# 0002: No durable workflows while keys are user-supplied

Date: 2026-11-17 · Status: accepted

## Context

The blueprint proposes Cloudflare Workflows for durable, multi-step research runs that survive the user closing the tab. It also requires that user API keys are never stored.

Workflows persist each step's inputs and outputs so they can resume after failures. A run that continues after the browser leaves would need the user's key in that persisted state (or in some other server-side store) for its later model calls.

## Decision

Research runs execute within the request that started them. Progress streams to the browser, and completed results are saved to D1, but the user's key exists only for the lifetime of that request.

## Consequences

- Keys are never written anywhere, which keeps the BYOK guarantee simple to state and to test.
- Closing the tab mid-run stops the run before its next model call. Results that completed are saved and reopen later.
- If runs that outlive the tab become important, options that keep the guarantee include:
  - A Durable Object holding the key **in memory only** for the run's duration. The run fails cleanly if the object is evicted.
  - Encrypting the key with a secret that only the user's browser holds, so the server cannot resume without the user.

  Either would be a separate decision.
