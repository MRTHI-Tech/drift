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

All documents carry `projectId` except `projects` themselves. Never query across projects. Collection names are exactly these:

- **projects/{projectId}** — `name`, `repo` (owner/name), `previewUrl`, `defaultBranch`, `configPath` (default `drift.config.json`), `createdAt`, `driftScore` (number, 0–100), `lastRunAt`.
- **runs/{runId}** — `projectId`, `trigger` (`scheduled` | `deploy` | `manual`), `startedAt`, `finishedAt`, `routesChecked`, `status` (`clean` | `findings` | `error`), `findingIds` (array), `error` (nullable).
- **screens/{screenId}** — `projectId`, `route`, `viewport` (`mobile` | `desktop`), `runId`, `screenshotPath` (`gs://bucket/object`), `computedStyles` (the extracted resolved-value record: keyed by stable selector, each value `{tag, box: {x, y, width, height}, styles}`, where `styles` carries exactly the properties in `STYLE_PROPERTIES` in `packages/core/src/constants.ts`), `text` (each element's own visible text, keyed by the same selectors as `computedStyles`, absent for elements with none), `signature` (see Signature type, null until the signature phase has run), `archetypeId` (nullable), `embedding` (vector, stored as array, null until the embedding phase has run), `capturedAt`.
- **archetypes/{archetypeId}** — `projectId`, `label` (model-proposed, user-editable), `screenIds`, `createdAt`.
- **conventions/{conventionId}** — `projectId`, `archetypeId` (nullable for product-wide), `property` (e.g. `cta.label`, `heading.size`, `copy.case`), `value`, `confidence` (`low` | `medium` | `high`), `evidenceScreenIds`, `exceptions` (array of `{screenId, reason}`), `status` (`derived` | `promoted` | `removed`), `updatedAt`.
- **findings/{findingId}** — `projectId`, `runId`, `type` (`token` | `pattern`), `screenId`, `conventionId` (nullable for token findings), `evidence` (structured: selector (nullable, the element the value was seen on), property, observedValue, expectedValue, expectedSource (nullable, the token or convention the expected value comes from), siblingScreenIds), `severity`, `status` (`open` | `resolved_conform` | `resolved_update_siblings` | `resolved_exception` | `dismissed`), `dedupeKey`, `prNumber` (nullable), `createdAt`, `resolvedAt`.
- **resolutions/{resolutionId}** — `projectId`, `findingId`, `action`, `resultingConventionChange` (nullable), `createdAt`. Append-only. Never delete.

Rules for working with this schema:
- `dedupeKey` is deterministic from `projectId + route + property + observedValue`, as a sha256 of the length-prefixed parts. It is not scoped to the element, so one hardcoded value inherited across a screen is one finding, cited at the first element in document order that shows it. A finding whose dedupeKey matches an existing finding is not created again. That covers dismissed findings too: dismissal is a user decision, and since findings are never deleted, an existing document of any status stands.
- Conventions require **3 or more agreeing screens** before they exist at all. Two screens agreeing is not a convention.
- Nothing is hard-deleted except by an explicit user action on the conventions page. Findings are never deleted, only status-changed.
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
- Model calls are limited to: archetype classification, pattern-drift judgment over pre-computed candidates, convention labelling, and PR/rules-file prose.
- Every model call uses structured output (JSON schema via Genkit) and is wrapped in a single retry with backoff. A second failure returns empty, never throws into the pipeline.
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

`GEMINI_API_KEY`, `GOOGLE_CLOUD_PROJECT`, `FIRESTORE_DATABASE` (default `(default)`), `STORAGE_BUCKET`, `GITHUB_TOKEN`, `GITHUB_REPO_ALLOWLIST` (comma-separated owner/name the agent may open PRs against), `PREVIEW_AUTH_COOKIE_VALUE` (value the render worker puts in the cookie named by `authCookieName`), `FIREBASE_*` (auth client config), `NEXT_PUBLIC_APP_URL`.

A project whose config sets `authCookieName` fails its run before the browser launches when `PREVIEW_AUTH_COOKIE_VALUE` is empty. Rendering a login page under a signed-in route's name would poison every later comparison, so this is loud rather than silent.

The `GITHUB_REPO_ALLOWLIST` is a hard gate: the agent refuses to open a PR against any repo not on it, regardless of what Firestore says.

## 9. What is out of scope until after August 31

Teams and invitations. Billing. Light mode. Production (non-preview) watching. More than one rules-file format. Route crawling (routes are declared in `drift.config.json`, always). Editor plugins. Any settings page beyond project name, preview URL, and repo. If a task drifts toward any of these, stop.
