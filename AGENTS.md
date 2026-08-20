# AGENTS.md — Drift

This file is the constitution for building Drift. Read it before generating anything. When a decision here conflicts with a convenient default, this file wins. If something is genuinely ambiguous, stop and ask rather than inventing.

Drift is a background agent that watches a deployed product, detects token drift and pattern drift in its rendered screens, lets the user resolve findings, opens PRs with fixes, and exports learned conventions as a rules file. One user, multiple projects, one dashboard.

---

## 1. Stack, locked

- **Language:** TypeScript everywhere. Strict mode. No JavaScript files.
- **Monorepo:** pnpm workspaces. Packages: `apps/dashboard` (Next.js), `apps/worker` (render worker), `packages/core` (shared types, schema, signature logic), `packages/agent` (Genkit flows).
- **Dashboard:** Next.js (App Router) on Cloud Run.
- **UI provider:** **shadcn/ui** with Tailwind, initialised from the project's custom preset. The dashboard app must be initialised with exactly: `npx shadcn@latest init --preset b3rnTs7YHI --template next --pointer`. The preset's theme is the design system; do not re-theme after init. See section 5 for usage rules.
- **Agent framework:** **Genkit** (satisfies the hackathon's Google Agent Framework requirement, Node-native). All model interaction goes through Genkit flows in `packages/agent`. No raw fetch calls to the Gemini API anywhere else.
- **Model:** Gemini 3.5 via the Gemini API key in env. Model IDs live in one constants file, never inline.
- **Database:** **Firestore** (Native mode). No other database. No ORM layer beyond a thin typed repository in `packages/core`.
- **Auth:** Firebase Auth, Google provider only. Single-user product for now; every route except `/login` requires a session. No roles, no invitations, no teams.
- **Storage:** Cloud Storage for screenshots. Bucket name from env.
- **Render worker:** Playwright with Chromium inside a Cloud Run **job** (not a service). Triggered by Cloud Scheduler or a Pub/Sub push in later phases; runnable locally via CLI at all times.
- **GitHub:** Octokit. Fine-grained PAT from env in early phases; GitHub App later. All GitHub calls live in one module, `packages/core/src/github.ts`.
- **Secrets:** env vars locally via `.env.local` (gitignored), Secret Manager in deployed environments. Never commit a secret, never log one.
- **Deploy target:** everything on Google Cloud. Dashboard and worker both Cloud Run. No Vercel, no Netlify, even for previews of Drift itself.

## 2. Firestore schema, locked

All documents carry `projectId` except `projects` and `installations`. Never query across projects. Collection names are exactly these:

- **projects/{projectId}** — `userId` (Firebase uid of whoever created it), `name`, `repo` (owner/name), `previewUrl`, `defaultBranch`, `configPath` (default `drift.config.json`), `installationId` (number, nullable: the GitHub App installation the repo was granted through, null for a project on `GITHUB_TOKEN`), `createdAt`, `driftScore` (number, 0–100), `lastRunAt`.
- **installations/{installationId}** — `installationId` (number), `userId`, `account`, `connectedAt`. Document id is the GitHub installation id, so reconnecting replaces rather than duplicates.
- **runs/{runId}** — `projectId`, `trigger` (`scheduled` | `deploy` | `manual`), `startedAt`, `finishedAt`, `routesChecked`, `status` (`clean` | `findings` | `error`), `findingIds` (array), `error` (nullable).
- **screens/{screenId}** — `projectId`, `route`, `viewport` (`mobile` | `desktop`), `runId`, `screenshotPath` (`gs://bucket/object`), `computedStyles` (the extracted resolved-value record: keyed by stable selector, each value `{tag, box: {x, y, width, height}, styles}`, where `styles` carries exactly the properties in `STYLE_PROPERTIES` in `packages/core/src/constants.ts`), `text` (each element's own visible text, keyed by the same selectors as `computedStyles`, absent for elements with none), `signature` (see Signature type, null until the signature phase has run), `archetypeId` (nullable), `embedding` (vector, stored as array, null until the embedding phase has run), `capturedAt`.
- **archetypes/{archetypeId}** — `projectId`, `label` (model-proposed, user-editable), `screenIds`, `createdAt`.
- **conventions/{conventionId}** — `projectId`, `archetypeId` (nullable for product-wide), `property` (e.g. `cta.label`, `heading.size`, `copy.case`), `value`, `label` (model-written, user-editable, the convention in plain language), `confidence` (`low` | `medium` | `high`), `evidenceScreenIds`, `exceptions` (array of `{screenId, reason}`), `status` (`derived` | `promoted` | `removed`), `updatedAt`.
- **findings/{findingId}** — `projectId`, `runId`, `type` (`token` | `pattern`), `screenId`, `conventionId` (nullable for token findings), `evidence` (structured: selector (nullable, the element the value was seen on), property, observedValue, expectedValue, expectedSource (nullable, the token or convention the expected value comes from), siblingScreenIds, sentence (nullable, the one-line reading of the evidence in plain language, written by the judgment phase for a pattern finding after its value passed the reconciliation gate)), `severity`, `status` (`open` | `resolved_conform` | `resolved_update_siblings` | `resolved_exception` | `dismissed`), `dedupeKey`, `prNumber` (nullable), `createdAt`, `resolvedAt`.
- **resolutions/{resolutionId}** — `projectId`, `findingId`, `action`, `resultingConventionChange` (nullable), `createdAt`. Append-only. Never delete.

An installation is the only thing in this schema that belongs to GitHub rather than to Drift. `installationId` is stored because a project has to remember which grant it was created under; what that grant *reaches* is never stored, because a person can change it on GitHub without telling Drift, and a cached copy would be wrong exactly when it mattered. Ask GitHub (`listAppInstallations`), the same way the default branch is asked for rather than typed.

Rules for working with this schema:
- `dedupeKey` is deterministic from `projectId + route + property + observedValue`, as a sha256 of the length-prefixed parts. It is not scoped to the element, so one hardcoded value inherited across a screen is one finding, cited at the first element in document order that shows it. A finding whose dedupeKey matches an existing finding is not created again. That covers dismissed findings too: dismissal is a user decision, and since findings are never deleted, an existing document of any status stands.
- Conventions require **3 or more agreeing screens** before they exist at all. Two screens agreeing is not a convention.
- Nothing is hard-deleted except by one of the two explicit user actions named below. Findings are never deleted by anything Drift does on its own, only status-changed.
- The two deletions a person may ask for are **removing a convention**, on the conventions page, and **removing a project**, from the switcher. Nothing else deletes, and neither is ever done on the agent's initiative.
- Removing a project removes everything scoped to it: its runs, screens, archetypes, conventions, findings, **and its resolutions**, along with every screenshot under its prefix in the bucket. The append-only rule on `resolutions` and the never-deleted rule on `findings` are guarantees inside a project, and they exist so a decision somebody made cannot be quietly undone. Neither survives the project itself, because every query in Drift is scoped by `projectId` and never crosses one: a removed project's findings could not be read by anything ever again, so keeping them would preserve no decision and cost storage forever. The document that indexes it all, the project, is deleted last, so a cascade that fails part way leaves a project that can be removed again rather than orphans nothing can reach.
- Schema changes require updating this file in the same commit.

### 2a. `drift.config.json`, locked

Each watched repo carries a `drift.config.json` at the project's `configPath`. It is the only declaration of what Drift renders; Drift never crawls (section 9). Unknown keys are rejected, so a typo is never silently ignored. Parsed by the zod schema in `packages/core/src/config.ts`.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `routes` | array of absolute paths, non-empty, unique | required | Routes to render on the preview URL |
| `viewports` | array of `mobile` \| `desktop`, non-empty, unique | `["mobile", "desktop"]` | Viewports each route is rendered at |
| `authCookieName` | string or null | `null` | Session cookie the render worker sets to reach signed-in routes |
| `seedData` | boolean | `false` | Whether the watched app needs its demo data seeded before a run |
| `tokenDefinitionsPath` | string or null | `null` | Repo-relative path to the file defining the design tokens |

Config changes require updating this table in the same commit.

## 3. The reconciliation gate, non-negotiable

Any finding proposed by a model call must be verified against the `computedStyles` record of the screen before it is written to Firestore. If the observed value the model cites does not appear in the computed-style record for the cited selector, the finding is dropped silently and a counter is logged. The model comments on candidates; it never originates facts. This rule has no exceptions and no config flag to disable it.

## 4. Model usage rules

- Deterministic first, always. Rendering, extraction, token diffing, dedupe, and signature construction never call a model.
- Model calls are limited to: archetype classification, pattern-drift judgment over pre-computed candidates, convention labelling, PR/rules-file prose, and the Fixer (section 10a). The Fixer is the only model call that reads a watched repo's source, the only one that calls tools, and the only one whose output is code.
- Every model call uses structured output (JSON schema via Genkit) and is wrapped in **at most** one retry with backoff. A second failure returns empty, never throws into the pipeline. At most, because the cap is on how many times a call may be made and not on how many must be: a failure that cannot come out differently is not retried at all. Running out of tool calls is the case that prompted this, where against a real repo the retry cost four minutes to reach the same empty answer twice. A caller says which failures are worth a second attempt by passing `retryable` to `attemptOrEmpty`; the default, and every call that does not pass one, retries everything as before.
- Prompts live in `packages/agent/src/prompts/` as named exports, one file per flow. No inline prompt strings.

## 5. Design system and shadcn/ui rules (this section prevents drift in Drift itself)

- **Theme:** the custom preset applied at init (`npx shadcn@latest init --preset b3rnTs7YHI --template next --pointer`) is the design system. Its CSS variables in `globals.css` and the Tailwind config it generates are the only source of colour, radius, and spacing. **Never modify the preset's variable values. Zero hardcoded hex values, zero arbitrary Tailwind values like `p-[13px]`, anywhere, ever. Every style references a preset variable or a Tailwind utility mapped to one.** Dark mode only for now.
- **Accent:** use the preset's designated accent/primary variable, and only for attention: unresolved findings, score changes, primary CTAs. Everything else stays on the preset's neutral surface and foreground variables.
- **Components:** add shadcn components via the CLI (`npx shadcn@latest add <component>`) as needed; they are copied into `components/ui/` and belong to the repo. Use them as the base for all interactive elements (button, card, dialog, dropdown-menu, tabs, badge, table, toast). Do not hand-write a component the registry provides, and do not edit files in `components/ui/` except to add variants through the existing cva variant pattern. Custom components are allowed only for what the registry does not have: the screen-thumbnail card, the side-by-side comparison view, the sparkline, the convention row. Custom components compose shadcn primitives and preset variables; they never introduce their own styling constants.
- **Typography:** one sans throughout, defined once in the theme. Type scale has at most 5 sizes. Evidence text gets generous line height because it must read as plain language, not logs.
- **Aesthetic:** dense, calm, precise. Linear/Vercel dashboard register. No decorative illustration. No gradients except, at most, one subtle surface treatment. Motion is functional only: score tick, finding resolve, nothing ambient.
- **The watched app's thumbnails must look like a different product** than Drift's own chrome, so it is always obvious what is Drift and what is the product under watch.
- **Layout:** persistent left nav. Top of nav: project switcher (repo name, mark, unresolved-findings badge and drift score per project in the menu). Nav items: Runs, Findings, Conventions. Nav footer: drift score with sparkline.

## 6. Interface copy rules

- Plain, specific, evidence-first. The agent always cites exact values and screen counts. "This screen says Next. 4 of 5 sibling screens say Continue." Never "inconsistency detected."
- Sentence case everywhere, including buttons and headings.
- No exclamation marks. No em dashes. No filler words: seamlessly, effortlessly, powerful, robust, leverage.
- The agent's voice is a careful colleague, not a mascot and not a cop. Findings are observations with evidence, resolutions are choices, exceptions are respected permanently.

## 7. Code conventions

- Small modules with one job. The worker pipeline is composed of pure functions where possible: `render → extract → sign → diff → judge → persist`, each independently testable.
- Shared types live in `packages/core/src/types.ts` and are the single source of truth. Firestore repositories return typed objects, never raw snapshots, to callers.
- Errors: the worker never dies mid-run silently. Every run writes a `runs` document even on failure, with `status: error` and the message. Partial results are persisted; a failed route does not abort the other routes.
- Logging: structured JSON logs (`console.log` with an object), because Cloud Run picks them up natively. Log every phase transition of a run with `runId` and `projectId`.
- No new dependencies without a comment in the PR explaining why. Prefer the platform: no axios (fetch), no moment (Date/Intl), no lodash unless something genuinely needs it.
- Tests: unit tests for `packages/core` pure functions (signature construction, token diffing, dedupe keys) using Vitest. No E2E test suite for the hackathon; the phase gates in the build prompt are the E2E tests.

## 8. Environment variables, canonical list

`GEMINI_API_KEY`, `GOOGLE_CLOUD_PROJECT`, `FIRESTORE_DATABASE` (default `(default)`), `STORAGE_BUCKET`, `GITHUB_TOKEN`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM, or base64 of one, because a `.env` file cannot hold a multi-line value), `GITHUB_REPO_ALLOWLIST` (comma-separated owner/name the agent may open PRs against), `PREVIEW_AUTH_COOKIE_VALUE` (value the render worker puts in the cookie named by `authCookieName`), `FIREBASE_*` (auth client config), `NEXT_PUBLIC_APP_URL`.

A project whose config sets `authCookieName` fails its run before the browser launches when `PREVIEW_AUTH_COOKIE_VALUE` is empty. Rendering a login page under a signed-in route's name would poison every later comparison, so this is loud rather than silent.

The `GITHUB_REPO_ALLOWLIST` is a hard gate: the agent refuses to open a PR against any repo not on it, regardless of what Firestore says.

Two GitHub credentials exist, and they are not alternatives of equal standing. A **GitHub App installation** is a person's grant, made on GitHub, over the repos they chose, and it is what a project should be on. The **fine-grained PAT** in `GITHUB_TOKEN` is the fallback it replaces, kept because a deployment with no app registered and a project created before one both have to keep working. `githubClientFor` in `packages/core/src/github.ts` is the one place that chooses between them, and `githubAuthMode` reports the choice so callers can log it.

The allowlist stays in force under both. An installation already bounds what Drift can reach, which makes the list the second lock on a locked door; it is kept anyway until the app has been proven in a deployed run, because the cost of the redundancy is a line in an env file and the cost of being wrong is a pull request on somebody else's repository. Removing it is a change to this section, deliberately.

## 9. What is out of scope until after August 31

Billing. Light mode. Production (non-preview) watching. More than one rules-file format. Route crawling (routes are declared in `drift.config.json`, always). Editor plugins. Any settings page beyond project name, preview URL, and repo. If a task drifts toward any of these, stop.

**Separate accounts are no longer on this list.** They were, and the decision was reversed on 2026-08-18: a person signing in for the first time has to arrive at their own empty Drift and connect their own GitHub, and a shared workspace makes that first run impossible to show. What was added is separation, not teams — one person, their own projects. Invitations, roles, and shared ownership stay out of scope, and nothing about this section licenses them.

The shape it takes is deliberate and is the thing to preserve: **Drift never decides who owns a repo.** GitHub decided that when somebody installed the app, and the picker can only ever offer what their own installation grants. `projects.userId` is only the memory of who made the project, and every read is checked against it.

## 10. What Drift may write into a watched repo

Two categories, and nothing outside them. The first governs fixes and is permanently bounded. The second governs the files Drift itself authors, and exists because the rules file was already one of them.

### 10a. Fixes to a finding: two classes, and what bounds each

**Amended 2026-08-19.** This section previously admitted one class and said the rest was out of scope "for good". That was reversed deliberately, with the reasoning below, and the sentence it replaces is quoted here so nobody has to read the history to know what changed: *"Everything else is out of scope for the agent for good, not until a later phase."*

The reversal is not a relaxation. The old boundary carried real safety, and a second boundary was built before it was removed. What follows is both classes and the bound on each.

**The mechanical class.** Drift changes two things in a watched repo's own source by substitution: the text of a label, and a value that missed its token. Both are one literal for another, planned by matching that literal character for character, with the match bounded so a label counts only as a whole string literal or a whole element's text and a value counts only where it is not part of a longer one. This class is safe for a reason worth naming: a substitution planned this way cannot be wrong about the code it edits, because it never read it.

**The model-authored class: the Fixer.** A finding the mechanical patcher cannot plan goes to `proposeFix` in `packages/agent/src/flows/propose-fix.ts`, which reads the repo's source through tools and writes the correction. This is the only place in Drift that reads code somebody else wrote. It is bounded by four things, and all four hold together or the class is not safe:

- **It is never asked first.** `planFindingPatch` runs and fails before the Fixer is called, and the Fixer is told the reason. Anything a substitution can do, a substitution does.
- **It sees a fixed set of files.** The tools in `packages/agent/src/repo-tools.ts` are pure functions over the files `fetchSourceFiles` already fetched and already filtered. There is no network behind them, no path out of the set, and no way for the repo to change underneath a fix.
- **Everything it proposes goes through the fix gate**, `gateProposedFix` in `packages/core/src/actuation/fix-gate.ts`, and the gate is inside the flow rather than beside it, exactly as the reconciliation gate is inside `judgePatternDrift`. There is no caller that can go around it. The gate is what stands where the old refusal stood, and its rules are stated in that file.
- **What it produces is a proposal.** A plan the Fixer wrote is marked `author: "model"`, and it opens as a **draft** pull request. The gate can prove an edit applies, is bounded, and touches the value the finding named. It cannot prove the result compiles, and Drift does not build the watched repo, so a person opens it.

**Two ways in, and the difference between them is who decided.** Unprompted, during a run, the Fixer is asked only about a token finding: a value that missed a named token has a right answer nobody has to choose, and `isAutonomousFix` still decides whether it goes out. Pattern drift never reaches the Fixer that way, because whether a screen or its siblings should change is a judgment about the product. It reaches it the other way, through `resolveFinding`, when a person has chosen `conform` or `update siblings` and the mechanical patcher cannot carry that choice out. The judgment is theirs and is already made; what is left is finding where the value is written, which is work rather than judgment. Nothing about that path is unprompted, so `isAutonomousFix` is not consulted for it, exactly as it is not consulted for anything in 10b.

**What is still out of scope, and this part did not change.** Drift does not edit the token file, does not move a value into a token, does not restructure or rename anything, and does not touch a test, a snapshot, a lockfile, or a generated file. The Fixer changes the value a finding is about and nothing else. A finding whose fix needs more than that is reported with its evidence and waits for a person, which is a correct outcome and not a failure.

### 10b. Files Drift authors: the setup class

Drift may also create and maintain files that it defines the schema of and that carry no meaning to the watched application at runtime. There are exactly two, and adding a third requires amending this section in the same commit:

- `drift.rules.md`, at the repo root, regenerated on any convention change.
- `drift.config.json`, at the project's `configPath`, and **only when the repo does not have one already**.

This class is separated from 10a because the risk it carries is a different risk. A patch under 10a edits source somebody else wrote, so its bound is that Drift must never need to understand that source. A file under 10b is authored entirely by Drift against a schema in this repository, so nothing about it depends on reading the watched repo's code at all.

The limits are strict and hold with no exception:

- Drift only ever creates or replaces a 10b file wholesale. It never merges into one, never edits one line of one, and never parses one it did not write.
- **A 10b file that already exists is a file a person owns.** An existing `drift.config.json` is never overwritten, whatever it says. A config that is present and invalid is reported to the person with the validation error and waits for them, exactly like a finding that is not mechanically fixable.
- A 10b file is never written into the default branch directly. `drift.rules.md` goes to `drift/rules` and `drift.config.json` goes to `drift/config`. Each arrives as a pull request the first time, because a new file in somebody's repository is a change they should see and accept; after that the branch is that file's home and regeneration commits onto it.
- No 10b file may contain anything a model wrote. Both are composed from what the deterministic phases already measured.

### 10c. What holds across both

Within 10a, a narrower subset may go out **unprompted**, and the boundary is one named function, `isAutonomousFix` in `packages/core/src/actuation/autonomy.ts`. This is true of both classes. A plan the Fixer wrote is decided by that same function and by nothing else, under conditions of its own: it must touch one file, and what it opens is a draft. Adding the second class did not add a second place where autonomy is decided, which was the point of having one. It is one function so that the whole of Drift's autonomy is auditable by reading one file, and so that widening it is a visible change to one place. It returns a reason either way and every caller logs it. Nothing else in the codebase may decide to open a pull request unprompted.

Nothing in 10b is ever unprompted, and `isAutonomousFix` is not consulted for it. Every 10b write is the direct result of a person doing something: regenerating the rules file follows a resolution somebody chose, and proposing a config follows somebody adding a project and asking for it. An unprompted write is a decision the agent made, and the agent makes no decisions about files it authors.

Every pull request body ends with the line `Opened by Drift.`, and every write goes through `packages/core/src/github.ts`, which refuses any repo not on `GITHUB_REPO_ALLOWLIST` (section 8).
