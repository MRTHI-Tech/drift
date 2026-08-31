# Submission copy — All Things Agentic Hackathon

Paste-ready text for the Devpost form. Nothing here is aspirational: every
capability described is in the repository and has run against a real product.

---

## Track

**Taskmaster.**

Drift's defining behaviour is that it acts without being asked. It renders a
deployed product on a schedule or on deploy, decides on its own which of the
problems it found have a right answer, and opens the pull requests. Nobody
starts it and nobody prompts it.

---

## Project name

**Drift**

## Tagline (elevator pitch, ~200 characters)

> Drift watches your deployed product, finds where the design has quietly come
> apart, and opens the pull requests that fix it — without being asked, and
> without ever guessing at a value it did not measure.

---

## About the project

### The problem

Design systems do not fail loudly. They fail one screen at a time.

Somebody ships a button in a slightly brighter indigo because it looked better
that afternoon. Six weeks later a different person, in a different sprint, with
no memory of the first three onboarding screens, writes a fourth one whose
button says "Submit" where the others say "Continue" and whose heading reads
"Account provisioning complete" where the others read "Let's get you set up".
Every one of those changes passed code review, because every one of them is
fine on its own. What is wrong is only visible across screens, and nothing in a
normal pipeline ever looks across screens.

Linters read source, not renders. Visual regression tools compare a screen to
its own past and go quiet when the drift ships in the first commit. Design
review is a person, once a quarter, from memory. So the drift accumulates, and
the honest answer to "is our product still consistent?" is that nobody knows.

### What Drift does

Drift is a background agent that watches a **deployed** product — the real
rendered thing, not the source — and does five things on its own.

**It measures.** A Cloud Run job renders every route the watched repo declares,
at every viewport it declares, with Playwright. It walks the resolved computed
styles and the visible text of every element and stores that record. That
record — not a model's impression of a screenshot — is the evidence for
everything that follows.

**It finds two kinds of drift.** *Token drift* is a value that missed the
design system: the run reads the repo's own token file as source, compares
every rendered colour, size, weight, spacing and radius against those scales,
and raises what sits off them with the nearest token attached. *Pattern drift*
is a screen that departs from what its own siblings agreed on: screens are
grouped into families by embedding distance, a value becomes a convention when
three or more screens of a family agree on it, and a screen that disagrees is
raised against it. A third kind, *component drift*, is counted product-wide —
square radio buttons on one screen when every other radio in the product is
round.

**It refuses to guess.** Every fact Drift states was measured deterministically
before any model was involved. The model is never handed a screen and asked
what is wrong with it; it is handed a numbered list of pre-computed candidates
and asked which ones matter. Anything it proposes must name a candidate from
that list, and the value it cites is read back out of the screen's own
extraction record before the finding is allowed to exist. Invented, rounded, or
misattributed values are dropped silently and counted. This gate has no
configuration flag.

**It opens pull requests nobody asked for.** A token finding whose value sits
close enough to the token it missed has a right answer that requires no human
judgment, so Drift fixes it: a bounded literal-for-literal substitution,
branched, opened, with before-and-after renders in the body. Where the value is
never written in source — composed at runtime from a variant map, say — the
substitution fails first and *then* a Gemini-backed Fixer reads the repository
through a fixed set of tools and writes the correction. Everything it proposes
passes a second gate that proves the edit applies to a file it actually read,
matches exactly once, stays in bounds, and arrives at the value the finding
named. Because that gate cannot prove the result compiles, a Fixer patch opens
as a **draft** and a person merges it. The whole of Drift's autonomy is one
function, in one file, that returns its reason either way.

**It checks whether the fix worked.** This is the part nothing else does. When
somebody resolves a finding and the pull request merges, the next run
re-renders the product and asks the only question that settles it: is the value
still on the screen? A merged, deployed fix that did not move the render is
reported as **ineffective** rather than fixed — the single most common way a
fix silently fails, and invisible to every tool that treats the merge as the
evidence.

And what the product settles on leaves the dashboard: conventions are exported
as `drift.rules.md`, committed to the watched repo, so the coding agent writing
screen twelve is told what screens one through eleven already decided.

### How it is built

TypeScript in strict mode, pnpm workspaces, four packages: a Next.js App Router
dashboard, a Playwright render worker, a core package holding every
deterministic analysis and every Firestore repository, and a Genkit package
that is the only path to a model anywhere in the system.

The architectural spine is a rule the repository enforces rather than
recommends: **rendering, extraction, token diffing, dedupe, signature
construction, convention counting and the drift score never call a model, and
may not.** Model calls are confined to six flows — archetype labelling, pattern
judgment over pre-computed candidates, convention labelling, screen embedding,
and the Fixer — and each returns structured output through a schema. A model
that is unavailable costs a run its pattern findings and nothing else; every
deterministic finding still lands.

The other spine is that every boundary a model crosses is a named function with
a test, not a convention: the reconciliation gate before Firestore, the fix
gate before a patch leaves the flow, `isAutonomousFix` before anything opens
unprompted, and a repository allowlist that refuses every GitHub write outside
it regardless of what the database says.

### Google Cloud

| Service | What it does here |
| --- | --- |
| **Cloud Run (service)** | The dashboard, behind Firebase Auth |
| **Cloud Run (job)** | The render worker, Playwright and Chromium in a container |
| **Firestore (Native)** | Every document: projects, runs, screens, archetypes, conventions, findings, resolutions |
| **Cloud Storage** | Full-page screenshots, served only through a signed proxy |
| **Cloud Build + Artifact Registry** | Both images, built linux/amd64 |
| **Pub/Sub** | The watched product publishes on redeploy; the push subscription starts a run, its identity token verified against the one service account allowed to push |
| **Cloud Scheduler** | The unattended run, one entry per watched project |
| **Cloud Logging** | One JSON object per line from both runtimes, every line carrying its run and project id |
| **Secret Manager** | Every credential in the deployed environment |
| **Firebase Auth** | Google provider; each person arrives at their own empty Drift |

Deployed in `africa-south1`, with Firestore, Cloud Run and Artifact Registry
all in the same region.

### Gemini and Genkit

**Gemini 3.5 Flash** (`gemini-3.5-flash`) behind every flow, and
`gemini-embedding-2` for the screen embeddings that place a screen with its
siblings. **Genkit** is the agent framework and the only way any of it is
reached: `packages/agent` is the single door, structured output on every call,
at most one retry, and a failure that returns empty rather than throwing into
the pipeline.

### Data sources

Drift uses no third-party dataset. Everything it reasons about is produced by
the product being watched:

- the resolved computed styles and visible text of each rendered screen, extracted in-browser
- the watched repo's design-token file, read as source text and never executed
- `drift.config.json` in the watched repo — the only declaration of what gets rendered; Drift never crawls
- repository contents and pull requests through the GitHub API, under a GitHub App installation the user granted
- full-page screenshots in Cloud Storage

### What was hard

The reconciliation gate exists because of what happened without it. A model
looking at a screenshot will confidently cite `#4F46E4` for a button that is
actually `#4F46E5`, and a finding built on that is worse than no finding: it is
a bug report that sends somebody looking for a value that does not exist. The
fix was to stop letting the model originate facts at all. It comments on
candidates the deterministic phase already measured, and every value it repeats
is checked against the screen's own record before anything is written. It drops
real proposals sometimes. That is the correct trade.

The second one: nothing in a repository contains the word "warm", so when a
heading has to be rewritten to sound warm again, there is no literal for a gate
to look for. That check reads the proposed line with the same function that
measured the original, so the gate and the measurement can never disagree about
what warm means.

### What's next

Production watching alongside preview, a second rules-file format for other
coding agents, and light mode — all deliberately fenced off until after the
deadline so the loop could be finished and proven first.

---

## Built with

`typescript` · `nextjs` · `genkit` · `gemini` · `google-cloud` · `cloud-run` ·
`firestore` · `cloud-storage` · `pub-sub` · `cloud-scheduler` · `cloud-build` ·
`firebase-auth` · `secret-manager` · `playwright` · `tailwindcss` ·
`shadcn-ui` · `octokit` · `github-api` · `pnpm` · `zod` · `vitest`

---

## Links to submit

| Field | Value |
| --- | --- |
| Hosted project | `https://drift-dashboard-5lkpfywnxq-bq.a.run.app` |
| Code repository | `https://github.com/MRTHI-Tech/drift` |
| Spin-up instructions | `README.md` — "Spin up", plus `deploy.md` for a full cloud deployment from an empty project |
| Architecture diagram | `docs/architecture-system.svg` and `docs/architecture-pipeline.svg` |
| Demo video | *(to add)* |

**Note for judges, worth stating on the form:** the dashboard is per-person —
signing in creates your own empty Drift, and a project is connected by granting
a GitHub App installation over your own repository. The demo video is the
walkthrough of a populated instance.

---

## Demo video — ~4 minutes

Four beats, roughly a minute each. Requirements the video must hit: the
problem, the value proposition, a live demo, and visible proof of Google Cloud
deployment.

**0:00–0:35 — the problem, shown not stated.** Two onboarding screens side by
side from the watched product. One says "Continue", one says "Submit". One
opens "Let's get you set up", one opens "Account provisioning complete". Both
shipped. Both passed review. Line: *nothing in a normal pipeline ever looks
across screens.*

**0:35–1:40 — a run, unprompted.** Cut to the Cloud Console: the Cloud Run job,
the Scheduler entry, the deploy that just published to Pub/Sub. Then the
dashboard filling with findings from a run nobody started. Show one token
finding with its nearest token, and — the beat to hold — the pull request
already open on GitHub that nobody asked for. This is the 40% criterion on
screen.

**1:40–2:30 — it sees the product, not the screen.** The conventions page: what
this family of screens agreed on, each row opening onto the screens it was
counted across. Then a component finding — a square radio next to a round one —
which needs no narration at all. Then the one that proves it is not noise: a
finding raised and deliberately *not* auto-fixed, with the reason logged. Line:
*Drift declining to act is as much the product as Drift acting.*

**2:30–3:20 — judgment stays yours, typing becomes Drift's.** Resolve a
finding as conform. The mechanical patch cannot reach the value, the Fixer
reads the repo, the fix gate passes it, a draft pull request appears with
before-and-after renders in the body. Merge it and one other; hand-fix a third
one *wrong*, on camera. Deploy.

**3:20–4:00 — the question nobody else asks.** The verification run, and three
outcomes on one screen: **fixed**, **ineffective**, **pending**. Land it:
*the merge is not the evidence. The render is.* Close on `drift.rules.md` in
the watched repo — the conventions leaving the dashboard and reaching the agent
that writes the next screen.

---

## Before you submit — the four things that are not writing

1. **Merge `feat/github-app` into `main`.** Judges open the default branch, and
   `main` is 45 commits behind the finished product.
2. **Redeploy both images.** The live revision is from 18 August and predates
   component drift, fix verification and the GitHub App.
3. **Record the video**, and put its URL on the form and in the README.
4. **Attach the diagrams** — Devpost wants an image, and Best Architectural
   Design is a $5k category the gated pipeline diagram is aimed squarely at.
