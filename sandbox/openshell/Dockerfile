# Synthora research runner for an NVIDIA OpenShell sandbox.
# Build from the repository root:
#   docker build -f sandbox/openshell/Dockerfile -t synthora-research:local .

FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --workspace @synthora/worker --include-workspace-root --ignore-scripts --no-audit --no-fund
RUN npm run build:cli --workspace @synthora/worker

FROM node:24-bookworm-slim
# CA bundle in /etc/ssl/certs: the system store OpenShell adds its proxy CA to.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
# One bundled file and the Node runtime. No package manager runs at sandbox time,
# so the only binary that needs network access is /usr/local/bin/node.
COPY --from=build /src/apps/worker/dist-cli/research.mjs /app/research.mjs
# OpenShell inspects HTTPS so it can swap credential placeholders for real keys.
# Trust the system certificate store, where a sandbox's proxy CA is installed.
ENV NODE_OPTIONS=--use-system-ca
USER node
WORKDIR /tmp
# No entrypoint: OpenShell runs the command given after `--`.
CMD ["node", "/app/research.mjs", "--help"]
