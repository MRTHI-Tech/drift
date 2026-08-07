# The render worker, as a Cloud Run job.
#
# A job rather than a service (AGENTS.md section 1): a run renders every
# declared route of a project, takes minutes, and answers no request. Cloud
# Scheduler starts one per project on an interval and the dashboard's deploy
# webhook starts one when a watched repo redeploys. Both pass the project and
# the trigger as container overrides, which is why this image sets an
# entrypoint and no default arguments: an execution that arrives without a
# command line should stop at the CLI's usage message rather than quietly
# render whichever project was baked in.
#
# Built from the repo root, not from this directory:
#
#   gcloud builds submit --config cloudbuild.worker.yaml .
#
# Nothing sensitive is in here and nothing sensitive may be. Every value in
# AGENTS.md section 8 arrives at runtime from Secret Manager, mounted by
# `gcloud run jobs deploy --set-secrets` (AGENTS.md section 1).

# The Playwright image, pinned to the exact version in apps/worker/package.json.
# It carries Chromium and the system libraries Chromium needs, both of which are
# most of the reason this image exists; the tag and the dependency have to move
# together, or `playwright install` will pull a second browser build at image
# build time and the image will be twice the size for no reason.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Manifests first, so a change to application code does not reinstall anything.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/agent/package.json packages/agent/

# The worker and what it depends on: `packages/core` and `packages/agent`, not
# the dashboard. Dev dependencies are installed on purpose. The worker runs from
# TypeScript source through tsx, exactly as it does on a laptop, so there is no
# build step here and no compiled output that could differ from what the tests
# ran against.
RUN pnpm install --frozen-lockfile --filter @drift/worker...

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/agent packages/agent
COPY apps/worker apps/worker

WORKDIR /app/apps/worker

# No CMD. Cloud Run passes the command line per execution, as an override:
#   ["run", "--project", "<projectId>", "--trigger", "scheduled" | "deploy"]
ENTRYPOINT ["node", "--import", "tsx", "src/cli.ts"]
