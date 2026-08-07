# The dashboard, as a Cloud Run service.
#
# Built from the repo root, not from this directory: it is a pnpm workspace and
# the build needs the lockfile, the workspace file, and `packages/core`, which
# the dashboard consumes as TypeScript source rather than as a built package.
#
#   gcloud builds submit --config cloudbuild.dashboard.yaml .
#
# Nothing sensitive is in here and nothing sensitive may be. Every value in
# AGENTS.md section 8 arrives at runtime from Secret Manager, mounted by
# `gcloud run deploy --set-secrets` (AGENTS.md section 1). There is no ARG for
# a secret and no `NEXT_PUBLIC_` variable to bake in: the Firebase client config
# is read on the server at request time and handed to the login page as a prop,
# which is why it is named `FIREBASE_*` rather than `NEXT_PUBLIC_FIREBASE_*`.

# ---- base -------------------------------------------------------------------
# Node 22 is the runtime Next 16 targets. `corepack enable` picks pnpm up from
# the `packageManager` field in the root package.json, so the version is pinned
# in one place and this file does not repeat it.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# ---- dependencies -----------------------------------------------------------
# Manifests first, so a change to application code does not reinstall anything.
# Every workspace manifest is copied even though only some are installed: pnpm
# checks the lockfile against the whole workspace before it filters.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/agent/package.json packages/agent/

# `--filter @drift/dashboard...` is the dashboard and what it depends on. It
# deliberately leaves out `apps/worker`, whose postinstall downloads Chromium:
# this image serves pages and renders nothing.
RUN pnpm install --frozen-lockfile --filter @drift/dashboard...

# ---- build ------------------------------------------------------------------
FROM deps AS build
COPY packages/core packages/core
COPY apps/dashboard apps/dashboard
COPY tsconfig.base.json ./

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN pnpm --filter @drift/dashboard build

# ---- runtime ----------------------------------------------------------------
# `output: "standalone"` in next.config.ts has already worked out which files
# the server needs and copied them, so this stage installs nothing. Traced from
# the monorepo root, so the layout under `standalone/` mirrors the repo and the
# entry point is `apps/dashboard/server.js`.
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Cloud Run sends requests to $PORT and the container has to listen on every
# interface, not just loopback.
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
EXPOSE 8080

COPY --from=build /app/apps/dashboard/.next/standalone ./
# The standalone server does not copy these two itself.
COPY --from=build /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=build /app/apps/dashboard/public ./apps/dashboard/public

CMD ["node", "apps/dashboard/server.js"]
