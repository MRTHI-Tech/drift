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
section 8. Nothing in this phase reads any of them yet, so the dashboard and
worker both run with the file empty.

## Scripts

Run these from the repo root.

| Command          | What it does                                          |
| ---------------- | ----------------------------------------------------- |
| `pnpm dev`       | Dashboard on http://localhost:3000                    |
| `pnpm build`     | Production build of the dashboard                     |
| `pnpm typecheck` | `tsc --noEmit` across every package                   |
| `pnpm test`      | Vitest unit tests in `packages/core`                  |
| `pnpm worker`    | Runs the worker CLI. Add `-- --help` for its options  |

## Where things go

- Shared types: `packages/core/src/types.ts`, the single source of truth.
- Model IDs: `packages/agent/src/models.ts`, never inlined anywhere else.
- Prompts: `packages/agent/src/prompts/`, one file per flow, named exports.
- GitHub calls: `packages/core/src/github.ts` once phase work reaches it.
- UI components: add them with `npx shadcn@latest add <component>` inside
  `apps/dashboard`. They land in `components/ui/` and belong to the repo. Do
  not hand-write what the registry provides, and do not change the preset's
  theme variables.

## Status

Phase 1, workspace scaffolding. The dashboard renders a placeholder page on the
preset theme. The worker launches Chromium and exits. No Firestore, no auth, no
render pipeline, no flows yet.
