# Drift

Drift is a background agent that watches a deployed product, detects token
drift and pattern drift in its rendered screens, lets you resolve findings,
opens PRs with fixes, and exports learned conventions as a rules file.

`AGENTS.md` is the constitution for this repo. Read it before changing
anything; where it conflicts with a convenient default, it wins.

## Workspace

| Path               | What it is                                                  |
| ------------------ | ----------------------------------------------------------- |
| `apps/dashboard`   | Next.js App Router dashboard, shadcn/ui on the preset theme |
| `apps/worker`      | Node CLI that renders watched screens with Playwright       |
| `packages/core`    | Shared types, Firestore schema constants, signature logic   |
| `packages/agent`   | Genkit instance and flows, the only path to the Gemini API  |

Everything is TypeScript in strict mode. Package manager is pnpm; the version
is pinned in `package.json` under `packageManager`.

## Spin up

Requires Node 20 or newer and pnpm 11.

```bash
pnpm install
```

The install runs `playwright install chromium` in `apps/worker`, which pulls
the Chromium build pinned to Playwright 1.62.1 (currently Chromium
151.0.7922.34). Expect a download on a cold machine.

Then copy the env template and fill it in:

```bash
cp .env.example .env.local
```

`.env.local` is gitignored. The canonical variable list lives in `AGENTS.md`
section 8. The worker reads it directly: `pnpm worker` loads `.env.local` from
the repo root if it is there.

## Scripts

Run these from the repo root.

| Command          | What it does                                          |
| ---------------- | ----------------------------------------------------- |
| `pnpm dev`       | Dashboard on http://localhost:3000                    |
| `pnpm build`     | Production build of the dashboard                     |
| `pnpm typecheck` | `tsc --noEmit` across every package                   |
| `pnpm test`      | Vitest unit tests in `packages/core` and `apps/worker` |
| `pnpm worker`    | Runs the worker CLI. Add `-- --help` for its options  |
| `pnpm seed`      | Creates one watched project document in Firestore     |

Seeding a project needs `GOOGLE_CLOUD_PROJECT` set and Google application
default credentials on the machine (`gcloud auth application-default login`):

```bash
pnpm seed --name "Acme" --repo "acme/web" --preview-url "https://acme-preview.a.run.app"
```

## Running a render

The worker renders exactly the routes in the watched repo's
`drift.config.json`, at each viewport it declares, and writes one `screens`
document per route per viewport plus one `runs` document.

```bash
pnpm worker -- run --project <projectId>
```

It needs `GOOGLE_CLOUD_PROJECT`, `STORAGE_BUCKET`, `GITHUB_TOKEN`, application
default credentials, and, for a project whose config sets `authCookieName`,
`PREVIEW_AUTH_COOKIE_VALUE`. Add `--dry-run` to render and extract without
writing anything, or `--route /pricing` to limit the run to one route.

A failed route is recorded and the run carries on. The run document is written
even when every route fails, with `status: error` and the reason.

## Where things go

- Shared types: `packages/core/src/types.ts`, the single source of truth.
- Firestore repositories: `packages/core/src/repositories/`, one per collection.
  They return typed objects, never raw snapshots.
- Watched-project config schema: `packages/core/src/config.ts`. The file shape
  is documented in `AGENTS.md` section 2a.
- Model IDs: `packages/agent/src/models.ts`, never inlined anywhere else.
- Prompts: `packages/agent/src/prompts/`, one file per flow, named exports.
- GitHub calls: `packages/core/src/github.ts` once phase work reaches it.
- UI components: add them with `npx shadcn@latest add <component>` inside
  `apps/dashboard`. They land in `components/ui/` and belong to the repo. Do
  not hand-write what the registry provides, and do not change the preset's
  theme variables.

## Status

Phase 3, the render worker. The worker loads a project, reads its
`drift.config.json` off GitHub, renders every declared route at every declared
viewport with motion disabled, walks the resolved computed styles and visible
text, uploads a full-page screenshot to Cloud Storage, and writes the `screens`
and `runs` documents. No signatures, no token diffing, no model calls, no PRs
yet. The dashboard still renders a placeholder page.
