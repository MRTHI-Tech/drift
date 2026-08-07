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
| `packages/core`    | Shared types, Firestore schema, token diffing, signatures   |
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

Where each value comes from, step by step, is in
[docs/credentials.md](docs/credentials.md).

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

It needs `GOOGLE_CLOUD_PROJECT`, `STORAGE_BUCKET`, `GITHUB_TOKEN`,
`GEMINI_API_KEY`, application default credentials, and, for a project whose
config sets `authCookieName`, `PREVIEW_AUTH_COOKIE_VALUE`. Add `--dry-run` to
render, sign, and diff without writing anything, or `--route /pricing` to limit
the run to one route.

A dry run skips judgment along with every other write, and a run limited to one
route has no siblings to compare that route against.

A failed route is recorded and the run carries on. The run document is written
even when every route fails, with `status: error` and the reason.

## Token diffing and signatures

Every screen is signed and diffed as it is captured. Neither step calls a
model, and neither may (`AGENTS.md` section 4).

The **signature** is built from the computed styles and the extracted text: the
interactive labels with their positions, the rendered type hierarchy as ordered
size and weight pairs, the count of content bands and the gaps between them,
and copy flags for case and imperative mood. It is stored on the `screens`
document.

The **token diff** reads the file the config points `tokenDefinitionsPath` at,
either a `tokens.json` or a `theme.ts` exporting colours, a spacing scale, and
a type scale. The `theme.ts` is read as source, never imported: Drift does not
run a watched repo's code. Every resolved colour, size, weight, spacing, and
radius on the screen is compared against those scales, and anything off them
becomes a `findings` document of type `token` carrying the element, the
property, the observed value, and the nearest token.

Findings go through the dedupe gate: one finding per project, route, property,
and observed value, whatever the status of the finding that already holds that
key. A second run over an unchanged screen therefore raises nothing, and a
finding that has been dismissed stays dismissed.

A project whose config declares no `tokenDefinitionsPath`, or whose path is
stale, still renders and still signs. The run logs `tokens.not_declared`,
`tokens.missing`, or `tokens.unreadable` and skips the diff.

## Archetypes, conventions, and pattern drift

Judgment runs once per run, after every route is in, because an archetype and
its conventions are properties of a set of screens rather than of any one
screen. It is additive: it reads what the deterministic phases wrote and adds
to it, and a model that is unavailable costs a run its pattern findings and
nothing else.

**Archetypes** are found by distance, not by opinion. Each screen's signature is
encoded as text, embedded, and compared against the archetypes the project
already has. A screen near one joins it, a group of three or more screens near
each other starts a new one, and a screen near nothing stays unassigned. An
unassigned screen is never judged for pattern drift: it has no siblings, so
there is nothing to compare it against. The model's only job here is to propose
the label a family is filed under. Screens are compared within one viewport,
because a route at 390px and the same route at 1440px are different layouts.

**Conventions** are counted, not concluded. Each screen is projected onto a few
element-scoped properties (`cta.label`, `cta.size`, `cta.radius`,
`heading.size`, `heading.weight`), each carrying the selector its value was read
from, and a value becomes a convention when it is the single most common one
across three or more screens of the archetype. A tie means the family has not
settled and states nothing. The model writes the convention's name and touches
nothing else about it.

**Pattern drift** is measured before a model sees it. A screen's profile is
compared against its archetype's conventions and the disagreements become
candidates, each already carrying a true selector, property, and observed
value. The model receives that numbered list, the conventions, and the
screenshot, and answers two questions per candidate: does this matter, and how
would you say it in one line. It is never handed a screen and asked what is
wrong with it.

**The reconciliation gate** (`AGENTS.md` section 3) is the last thing between a
model and Firestore, and it is inside the flow rather than beside it. Every
proposal has to name a candidate from the list it was given, and the value it
cites is read back out of the screen's own extraction record: a style value
against `computedStyles`, a copy value against `text`, with the cited element
required in `computedStyles` either way. Anything invented, rounded, reworded,
or attributed to the wrong element is dropped silently and counted, and the
counter is logged under `judge.gate`. Findings that survive are written as
`findings` of type `pattern` through the same dedupe gate token findings use.

## Where things go

- Shared types: `packages/core/src/types.ts`, the single source of truth.
- Deterministic analysis: `packages/core/src/analysis/`. Token parsing, colour
  and length comparison, the token diff, signature construction, and the copy
  heuristics. Nothing in there may call a model.
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

The model-powered layer. The worker loads a project, reads its
`drift.config.json` and its token file off GitHub, renders every declared route
at every declared viewport with motion disabled, walks the resolved computed
styles and visible text, signs each screen, diffs it against the tokens,
uploads a full-page screenshot to Cloud Storage, and writes the `screens`,
`findings`, and `runs` documents. It then classifies each screen into an
archetype, derives that archetype's conventions, and raises pattern findings
where a screen departs from them, with every model-cited value reconciled
against the screen's own record first.

No PRs, no rules-file export, and no resolution flow yet. The dashboard still
renders a placeholder page.
