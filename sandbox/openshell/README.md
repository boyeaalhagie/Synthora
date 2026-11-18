# Running Synthora in an NVIDIA OpenShell sandbox

This runs the full research pipeline (plan → search → extract → analyse → verify → write) inside an [OpenShell](https://github.com/NVIDIA/OpenShell) sandbox:

- **Network:** only `node` can connect, and only to PubMed, Europe PMC, Crossref (read-only) and your model provider. Everything else is denied and logged.
- **Key:** your key stays in the OpenShell gateway. The sandbox gets a placeholder that the proxy replaces with the real key on requests to your provider.
- **Filesystem and user:** read-only apart from `/tmp`, run as a non-root user.

Why it runs beside the hosted app rather than in front of it: [decision 0003](../../docs/decisions/0003-openshell-sandboxed-runner.md).

## Requirements

- Linux (Ubuntu or Debian) with Docker Engine 28+ and kernel 6.2+ with Landlock enabled. A free Oracle Cloud Ampere VM works, and the image builds for arm64.
- macOS with Docker Desktop is also supported. Windows (WSL 2 with Docker Desktop) is experimental in OpenShell.

## Steps

From the repository root:

```bash
# 1. Install OpenShell and check the gateway is up
curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh
openshell status

# 2. Build the image
docker build -f sandbox/openshell/Dockerfile -t synthora-research:local .

# 3. Store your key in the gateway (reads it from your shell; it is not put in the image)
export ANTHROPIC_API_KEY=...        # or OPENAI_API_KEY / GEMINI_API_KEY
openshell provider create --name synthora-anthropic --type anthropic --credential ANTHROPIC_API_KEY
unset ANTHROPIC_API_KEY

# 4. Run a question in the sandbox
openshell sandbox create --name synthora \
  --from synthora-research:local \
  --policy sandbox/openshell/policy.yaml \
  --provider synthora-anthropic \
  -- node /app/research.mjs "Does metformin reduce cancer risk in type 2 diabetes?" \
     --provider anthropic --model <model-id> --top 5 > report.md

# 5. See what the sandbox allowed and denied
openshell logs synthora --since 30m --source sandbox
```

Progress is printed to stderr and the report (Markdown) to stdout. Use `openshell provider list-profiles` to see the exact profile names for OpenAI and Gemini.

Optional settings that are not secret go in with `--env`: `NCBI_EMAIL`, `NCBI_API_KEY`, `CROSSREF_MAILTO`.

Do not filter the logs with `--level warn`. That hides policy events.

## Checking the policy works

Try something the policy should block. It should fail, and `openshell logs` should show `action=deny`:

```bash
openshell sandbox create --from synthora-research:local --policy sandbox/openshell/policy.yaml \
  -- node -e "fetch('https://example.com').then(r => console.log(r.status), e => console.log('blocked:', e.message))"
```

## Without OpenShell

The same program runs directly, for development:

```bash
npm run build:cli --workspace @synthora/worker
ANTHROPIC_API_KEY=... node apps/worker/dist-cli/research.mjs "<question>" --provider anthropic --model <model-id>
# or, without building: npm run research -- "<question>" --provider anthropic --model <model-id>
```

## What has been verified

| Item | Status |
|---|---|
| CLI runs the full pipeline under Node | ✅ Tested against live PubMed, Europe PMC and Crossref. The model step was tested only with an invalid key, which failed cleanly. |
| An OpenShell placeholder is accepted as a key | ✅ Unit test |
| Policy covers every host the code calls, enforces every rule, and allows only `node` | ✅ `test/openshell-policy.test.ts` |
| Image builds; policy loads in a live gateway | ⬜ Not yet run: the development machine has no Docker or Linux kernel |
| Node trusts the proxy's certificate (`--use-system-ca`) | ⬜ Assumed from OpenShell's design; confirm on first run |
| Read-only filesystem paths are enough for Node | ⬜ Confirm on first run. If Node fails at startup, check `openshell logs` for denied paths |
