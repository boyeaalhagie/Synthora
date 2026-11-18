# Running Synthora in an NVIDIA OpenShell sandbox

This runs the full research pipeline (plan → search → extract → analyse → verify → write) inside an [OpenShell](https://github.com/NVIDIA/OpenShell) sandbox:

- **Network:** only `node` can connect, and only to PubMed, Europe PMC, Crossref (read-only) and your model provider. Everything else is denied and logged.
- **Key:** your key stays in the OpenShell gateway. The sandbox gets a placeholder that the proxy replaces with the real key on requests to your provider.
- **Filesystem and user:** read-only apart from `/tmp`, run as a non-root user.

Why it runs beside the hosted app rather than in front of it: [decision 0003](../../docs/decisions/0003-openshell-sandboxed-runner.md).

## Requirements

- Linux (Ubuntu or Debian) with Docker Engine 28+ and kernel 6.2+ with Landlock enabled. A free Oracle Cloud Ampere VM works, and the image builds for arm64.
- macOS with Docker Desktop is also supported. Windows (WSL 2 with Docker Desktop) is experimental in OpenShell, but it works with the setup below.

### Windows (WSL 2 + Docker Desktop)

Tested with OpenShell 0.1.9, Ubuntu 26.04 on WSL 2 (kernel 6.18), and Docker Desktop 29.9.

1. **Docker Desktop → Settings → WSL integration:** turn on your Ubuntu distro, then **Apply & restart**.
2. **Docker Desktop → Settings → Network → Enable host networking**, then **Apply & restart**. Each sandbox's supervisor uses host networking to reach the gateway at `127.0.0.1:17670`. With this on, a container's localhost reaches Windows, and WSL forwards that port to the gateway in Ubuntu.
3. Install OpenShell inside Ubuntu (step 1 below). If the gateway fails with `no compute driver configured`, the service manager started before you joined the `docker` group. Then:
   ```bash
   mkdir -p ~/.config/openshell && echo OPENSHELL_COMPUTE_DRIVER=docker > ~/.config/openshell/gateway.env
   ```
   From PowerShell, run `wsl --terminate Ubuntu`, reopen Ubuntu and run `systemctl --user restart openshell-gateway`. If Ubuntu starts before Docker Desktop has connected, the gateway retries every 5 seconds until `/var/run/docker.sock` appears.
4. Run the commands below from the repository through `/mnt/c/...`. The image built by Docker Desktop on Windows is the same one the gateway sees.

## Steps

From the repository root:

```bash
# 1. Install OpenShell and check the gateway is up
curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh
openshell status

# 2. Build the image
docker build -f sandbox/openshell/Dockerfile -t synthora-research:local .

# 3. Import the provider profile (once per gateway; OpenShell 0.1.9 ships none)
openshell provider profile import -f sandbox/openshell/providers/openai.yaml --global

# 4. Store your key in the gateway. Run this line on its own, paste the key
#    (it is not shown), press Enter, then run the next two lines.
read -rs OPENAI_API_KEY && export OPENAI_API_KEY
openshell provider create --name synthora-openai --type openai --credential OPENAI_API_KEY
unset OPENAI_API_KEY

# 5. Run a question in the sandbox
openshell sandbox delete synthora 2>/dev/null
openshell sandbox create --name synthora \
  --from synthora-research:local \
  --policy sandbox/openshell/policy.yaml \
  --provider synthora-openai \
  -- node /app/research.mjs "Does metformin reduce cancer risk in type 2 diabetes?" \
     --provider openai --model gpt-5.5 --top 5 \
  | sed -n '/^# /,$p' > report.md

# 6. See what the sandbox allowed and denied
openshell logs synthora --since 30m --source sandbox | grep -E "ALLOWED|DENIED"
```

Progress goes to the terminal and the report (Markdown) to `report.md`. OpenShell prints its own startup lines to the same output. `sed -n '/^# /,$p'` drops them by keeping everything from the report's `# Title` line onward.

For Anthropic or Gemini, import a profile for that provider first. Copy it from `providers/` in the [OpenShell repository](https://github.com/NVIDIA/OpenShell/tree/v0.1.9/providers) and set `binaries: [/usr/local/bin/node]`, as `providers/openai.yaml` here does. Check what is imported with `openshell provider list-profiles`.

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

Run on OpenShell 0.1.9 (WSL 2 + Docker Desktop), 2026-11-17.

| Check | Result |
|---|---|
| Image builds; policy loads in a live gateway | ✅ |
| Site not in the policy (`example.com`) | ✅ Blocked: `DENIED /usr/local/bin/node -> example.com:443 [reason:transparent_tcp_policy_denied]` |
| Allowed sites (PubMed, Europe PMC, Crossref, Anthropic) | ✅ Allowed, each logged with the rule that matched |
| Write request to a read-only site (`POST` to Crossref) | ✅ Blocked by OpenShell: `policy_denied … POST /works not permitted by policy` |
| Filesystem | ✅ Writes to `/app` and `/etc` fail with `EACCES`; `/tmp` is writable |
| Node trusts the proxy's certificate (`--use-system-ca`) | ✅ HTTPS through OpenShell's inspection works |
| Full pipeline inside the sandbox | ✅ 50 records from 2 sources, 2 of 2 DOIs confirmed, 0 denials. The model step ran with a dummy key, which the provider rejected as expected. |
| Real key supplied through an OpenShell provider (placeholder swap) | ⬜ Needs a real key; a placeholder is accepted by the CLI (unit test) |
| Policy covers every host and request shape the code uses | ✅ `test/openshell-policy.test.ts` |

The first live run found two policy gaps, both now fixed and covered by tests. PubMed fetches records with `POST`, and Crossref lookups contain `%2F`.
