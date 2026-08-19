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

The dashboard adds projects too, and both go through `createProject` in
`packages/core/src/projects/`, so a project added in a browser and one added at
a terminal are the same document with the same defaults and the same uniqueness
rule. See [Adding a project](#adding-a-project).

## Firestore indexes

Every repository query that filters by project and sorts at the same time needs
a composite index. They are declared in `firestore.indexes.json` and have to
exist before the dashboard will load a page; the worker survives without them
because its queries are equality-only.

```bash
firebase deploy --only firestore:indexes
```

Without the Firebase CLI, `gcloud firestore indexes composite create` takes the
same fields one index at a time. A query that pairs a new `where` with an
`orderBy` needs a new entry in that file, in the same commit.

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
element-scoped properties (`cta.label`, `cta.voice`, `cta.size`, `cta.radius`,
`heading.size`, `heading.weight`, `heading.tone`, `content.layout`,
`content.padding`, `content.gap`, `content.width`), each carrying the selector
its value was read from, and a value becomes a convention when it is the single
most common one across three or more screens of the archetype. A tie means the
family has not settled and states nothing. The model writes the convention's
name and touches nothing else about it.

Each property is read off one of three anchors: the screen's terminal action,
its first heading, and the container those two sit inside. The container is
found by geometry rather than by selector, because a selector is anchored at
the nearest stable ancestor and an element carrying its own `data-testid` has
one that says nothing about where it sits. The smallest recorded box enclosing
both other anchors is the container, `body` is never it, and a screen missing
either anchor has no container and holds no `content` values.

A container that reports `gap: normal` or `max-width: none` holds no value for
that property rather than a value of none. Those are what a block element
reports whether or not anybody decided anything, and a family agreeing on them
has agreed on nothing. It also means a screen rebuilt as a block does not
acquire a wrong gap; it stops having one, and only the properties it really
disagrees on are raised.

Two of those properties are read out of the recorded text rather than looked up
in it. `cta.voice` says whether an action names itself or could sit on any
screen, and `heading.tone` says whether a heading speaks to a person, keeps its
distance, or does neither. Both are word lists in
`packages/core/src/analysis/copy.ts`, no model call, and both exist because a
convention sometimes has to be stated over a quality that no two screens spell
the same way. An onboarding flow that opens "Hey, how are you?" and four screens
later asks for "Personal information" shares no word between those two lines.
Counting the words finds nothing. Counting the register finds it.

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

## Resolutions, pull requests, and the rules file

A finding is an observation. What happens to it is a person's decision, and
there are four of them. Each writes a `resolutions` document, which is
append-only and never deleted, moves the finding's status, updates the
convention where the action implies it, and opens a pull request where the
action implies one.

| Action | What it means | What it does |
| --- | --- | --- |
| conform | the convention was right | patches this screen to it |
| update siblings | this screen was right | moves the convention here, promotes it, patches the siblings |
| accept as exception | this screen may differ | records the reason on the convention, permanently |
| dismiss | nothing to do | status only |

All four go through `resolveFinding` in `packages/core/src/actuation/`, which is
what both the dashboard's API routes and the worker's temporary CLI command
call, so a finding resolved from a browser and one resolved from a terminal
take exactly the same path.

```bash
pnpm worker -- resolve --finding <findingId> --action conform
```

**What Drift patches** falls into two classes (`AGENTS.md` section 10a). The
mechanical class is a label's text and a value that missed its token,
substituted literal for literal. The match is bounded, so `Next` inside
`Next.js` is not a label and `#ff0000` inside `#ff0000ff` is not a colour. A
substitution planned this way cannot be wrong about the code it edits, because
it never read it.

**The Fixer** is the second class, and it is the only part of Drift that reads
a watched repo's source. It is asked only after the mechanical patcher has
tried and failed, and it is told why, so it spends its attention on the case a
substitution cannot reach: a value the source never writes down, because it is
composed at runtime or held in a variable the screen resolves. It searches and
reads the repo through pure functions over the files already fetched, and
everything it proposes goes through the fix gate before it leaves the flow. The
gate proves an edit applies to a file the Fixer actually read, matches there
exactly once, stays inside its bounds, and arrives at the value the finding
named. It cannot prove the result compiles, so a fix from the Fixer opens as a
**draft** and a person merges it.

Arriving at the value means one of two things. For a value or a label, the
target is written in source and the gate looks for it. For a derived property
it cannot be: nothing in a repo contains the word `warm`, and a heading
rewritten to sound warm never will. Those are checked by reading the new line
the same way the screen's own line was read, with the same function, so the
gate and the measurement always agree about what warm means.

**Pattern drift reaches the Fixer only through a resolution.** During a run the
Fixer is asked about token findings alone, because a value that missed a named
token has a right answer nobody has to choose. Whether this screen or its five
siblings are the ones that should change is a judgment about the product, so
Drift does not make it. When a person makes it, by choosing conform or update
siblings on a finding, the Fixer is asked to carry it out, and a label, a tone,
or a container that no substitution could reach becomes a draft pull request.
The judgment stays theirs; the typing becomes Drift's.

**Unprompted pull requests** are a narrower subset again: a token finding,
nobody has decided anything about it, it names the token it missed, and the
value sits close enough to that token that snapping it is a correction rather
than a choice. A mechanical patch also has to be exactly one occurrence in one
file; a Fixer patch has to be one file, its edits already bounded by the gate.
The one function drawing that line is `isAutonomousFix`, for both classes, and
every finding a run raises is logged under `actuate.decision` with the reason
it was or was not acted on.

**Branches** in the watched repo: `drift/fix-<findingId>` carries one patch and
is what the pull request proposes; `drift/rules` carries `drift.rules.md`;
`drift/config` carries a `drift.config.json` proposed for a repo that has none;
`drift/evidence` carries the before and after images the pull request bodies
embed and is never proposed or merged, so a pull request contains the patch and
only the patch.

`drift.rules.md` and `drift.config.json` are the two files Drift authors rather
than patches, and `AGENTS.md` section 10b is what bounds them: Drift composes
them whole, never parses one it did not write, and never overwrites a
`drift.config.json` that is already there.

**The rules file** is `drift.rules.md` at the root of the watched repo, written
in imperative plain language for a coding agent: what to label the action on
each kind of screen, what to set its type to, how the copy reads, and which
screens are recorded exceptions. It is regenerated on any convention change,
proposed as a pull request the first time and committed straight to
`drift/rules` after that, and it carries no timestamp so an unchanged product
regenerates an identical file and commits nothing.

```bash
pnpm worker -- rules --project <projectId> --dry-run
```

**The allowlist** is checked before every GitHub write and before any request
leaves the process, against `GITHUB_REPO_ALLOWLIST` (`AGENTS.md` section 8). An
unset variable means no repo is writable rather than every repo. A project whose
repo is not on it still renders, signs, diffs, and judges; it opens nothing.

## The dashboard

`pnpm dev` serves it on http://localhost:3000. It reads `.env.local` from the
repo root, the same file the worker reads, and it needs Google application
default credentials on the machine like everything else that touches Firestore.

Sign-in is Firebase Auth with the Google provider and nothing else. The browser
exchanges its ID token once for an httpOnly session cookie, and every page and
every route handler verifies that cookie on the server. `proxy.ts` also redirects
anyone without one, but that is an optimistic check and not the gate.

| Page | What is on it |
| --- | --- |
| Runs | Every run newest first, the latest one open, its findings inline, and the pull requests it opened unprompted |
| Findings | What is waiting and what has been decided. One finding opens the comparison view |
| Conventions | Grouped by archetype, each row opening onto the screens it was counted across, plus the `drift.rules.md` card |

### Adding a project

Two fields, because two things cannot be derived: which repo, and where it is
deployed. The name is filled in from the repo and can be edited. Everything else
is read out of the repo, and routes especially are never asked for here:
`drift.config.json` is the only declaration of what gets rendered, and a second
place to state it would be a second truth.

Four things are checked while the form is still open, because every way a run
fails traces back to one of them.

| Check | What it asks | On failure |
| --- | --- | --- |
| Repo | Can this token read it, and what is its default branch | Blocks |
| Config | Is there a `drift.config.json`, and does the strict schema accept it | Blocks |
| Preview | Does the preview answer for the first route the config declares | Warns |
| Tokens | Does the file at `tokenDefinitionsPath` parse | Warns |

The split is the one the worker already makes: a repo it cannot read and a
config it cannot parse leave nothing to render, and a dead preview or an
unreadable token file cost a run some of what it would have found and none of
what it would have rendered. The default branch comes from GitHub rather than
from the form, so a repo on `master` is not a project that fails every config
check.

Two more things are stated without being checks. A repo that is not on
`GITHUB_REPO_ALLOWLIST` is watched, scored, and never sent a pull request, which
is said rather than discovered. A config that sets `authCookieName` needs
`PREVIEW_AUTH_COOKIE_VALUE`, which today is one variable for every project.

A repo with no config gets both ways out: the file Drift would write, to copy,
and, when the allowlist permits it, a pull request onto `drift/config` that adds
it. That file is a setup file under `AGENTS.md` section 10b, not a patch, and it
is only ever proposed where there is no config already. An existing one is never
overwritten, whatever it says.

Saving starts the project's first run, with `trigger: manual`, so a new project
has something on its pages rather than looking broken. Locally there is no
worker job to start, so the dialog says so and gives the command to run instead:
the project is created either way.

### Removing a project

The switcher removes one too. This is one of the two deletions in Drift
(`AGENTS.md` section 2, the other being a convention), and the only one that
reaches more than a single document, so it states exactly what is about to be
lost, counted, and asks for the project's name to be typed.

It deletes the project's runs, screens, archetypes, conventions, findings and
resolutions, and every screenshot under its prefix in the bucket. Resolutions
are append-only everywhere else, and go here because every query in Drift is
scoped by `projectId`: once the project is gone nothing could read them again,
so keeping them would preserve no decision and cost storage forever.

The order is images, then the collections, then the project document last. The
project is the index into everything else, so a cascade that fails part way
leaves a project that can simply be removed again rather than documents nothing
can reach.

The comparison view is the centre of it: the divergent screen's real capture
beside the real captures of the screens its value was counted against, the cited
element boxed on each from that screen's own extraction record, and the three
ways to answer it wired to the resolution routes.

Screenshots are served through `/api/screens/[screenId]/image`, which checks the
session and then streams the object at the screen's `screenshotPath`. The bucket
stays private and the browser never sees a signed URL.

**The drift score** is open findings over screens checked, as a percentage, 0 to
100, stored on the project. It is recomputed when a finding is resolved and when
the dashboard loads, and it is written only when it moved. The sparkline beside
it is real history: a finding records when it was raised and when it was
resolved, so what was open at the end of any past run is reconstructed rather
than remembered.

## Deploying

Everything runs on Google Cloud (`AGENTS.md` section 1). The dashboard is a
Cloud Run service and the worker is a Cloud Run job, built from
`apps/dashboard/Dockerfile` and `apps/worker/Dockerfile` through the two
`cloudbuild.*.yaml` files at the root. Every command, in order, from an empty
project, is in [deploy.md](deploy.md).

Deployed, a run starts one of three ways and the `runs` document records which.

| Trigger | What starts it |
| --- | --- |
| `scheduled` | A Cloud Scheduler entry per watched project, on that project's interval |
| `deploy` | The watched repo publishes to a Pub/Sub topic when its preview redeploys; the push subscription reaches the dashboard, which starts the job |
| `manual` | A person, at a terminal or with `gcloud run jobs execute` |

All three end at one execution of the same job, with the project and the
trigger on its command line. The dashboard's push endpoint is the only route
not behind the session cookie, because a push subscription cannot carry one; it
verifies the identity token Google signs every push with instead, against its
own URL and against the one service account allowed to push.

Both runtimes write one JSON object per line, so every field is queryable in
Cloud Logging and every line a run writes carries its `runId` and `projectId`.
The query that shows one run end to end is in `deploy.md` section 13.

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
- GitHub calls: `packages/core/src/github.ts`, all of them, including the
  allowlist gate every write passes through first.
- Actuation: `packages/core/src/actuation/`. Patch planning, pull request and
  rules-file composition, the resolution engine, and the autonomy boundary.
  Nothing in there calls a model either: the two things a pull request needs to
  say are the evidence line the judgment phase already wrote and the
  substitution the planner already measured.
- Watched projects: `packages/core/src/projects/`. What a person types and what
  it has to become, the four preflight checks, the one function that writes the
  document, the config Drift proposes to a repo that has none, and the first run.
- Dashboard data loading: `apps/dashboard/lib/data/`. Server-only modules that
  assemble what a page needs out of the typed repositories, so no page component
  ever queries.
- The drift score: `packages/core/src/score.ts`. Counted, never modelled.
- UI components: add them with `npx shadcn@latest add <component>` inside
  `apps/dashboard`. They land in `components/ui/` and belong to the repo. Do
  not hand-write what the registry provides, and do not change the preset's
  theme variables.

## Status

Actuation. Drift now writes to GitHub.

The worker loads a project, reads its `drift.config.json` and its token file off
GitHub, renders every declared route at every declared viewport with motion
disabled, walks the resolved computed styles and visible text, signs each
screen, diffs it against the tokens, uploads a full-page screenshot to Cloud
Storage, and writes the `screens`, `findings`, and `runs` documents. It then
classifies each screen into an archetype, derives that archetype's conventions,
and raises pattern findings where a screen departs from them, with every
model-cited value reconciled against the screen's own record first. Last, it
asks the autonomy boundary about every token finding it raised and opens the
pull requests that qualify.

A finding can be resolved four ways, from the dashboard's API routes or from the
worker's temporary CLI command, and a resolution opens the patch it implies,
updates the convention it implies, and regenerates `drift.rules.md`.

The dashboard is the whole loop: sign in, read the last run, review a finding
against its siblings, resolve it, watch the score move, and read the rules file
Drift would write now. Every route except `/login` requires a session.
