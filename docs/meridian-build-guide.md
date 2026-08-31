# Meridian — the demo build guide

A watched product built from scratch in a chat that knows nothing about Drift,
so the drift Drift finds is drift a real build produced rather than drift
somebody planted. This file is the director's copy: it says what to build, what
to paste, what should go wrong, and what to have recording while it does.

Nothing here is built in the Drift repo. Meridian is its own directory, its own
GitHub repo, its own Cloud Run service.

---

## 1. The product

**Meridian** — expense tracking for small teams. Boring on purpose: nobody
watching the video should be forming an opinion about the product.

No marketing site. The product starts where somebody actually enters it.

Ten routes, two viewports, twenty screens a run.

| Family | Routes |
| --- | --- |
| Entry | `/`, `/invite/accept` |
| Onboarding | `/onboarding/profile`, `/onboarding/workspace`, `/onboarding/team`, `/onboarding/plan`, `/onboarding/done` |
| Settings | `/settings/account`, `/settings/billing`, `/settings/notifications`, `/settings/security` |

`/` is a get-started screen: workspace name, one primary button, a sign-in link
underneath. `/invite/accept` is what somebody lands on from an invite email.

The entry pair stays a pair on purpose. Two screens cannot found an archetype —
that needs three — so on run 1 there are no conventions and nothing is judged for
pattern drift. Whether `/` later joins the onboarding family once five
onboarding screens exist is genuinely up to the signature distance, and **both
outcomes are a demo**: see phase 5.

### Rules the app has to obey

These are constraints on the watched product, not preferences. Each one exists
because of how a run works.

1. **Every route renders standalone, signed out.** No auth gate, no redirect, no
   middleware. The worker renders a URL; if it lands on a login page it has
   rendered a login page ten times.
2. **Every route is deterministic.** No `new Date()`, no `Math.random()`, no
   generated ids, no "3 minutes ago". A timestamp that moves changes the
   screen's text, its signature, and its findings between runs for no reason.
3. **Mock data is hard-coded** in the page or in a `lib/mock.ts`. Nothing is
   fetched.
4. **`theme.ts` is the only place a token value is written.** Every drift below
   is a value written somewhere else.
5. **One commit per screen**, so the git history reads like a build when it is
   on screen.

### The token file

`theme.ts` at the repo root, which is what `tokenDefinitionsPath` points at.
Drift reads it as source and never imports it, so plain exported object
literals are the whole requirement.

```ts
export const colors = {
  brand:    { 50: "#EEF2FF", 100: "#E0E7FF", 500: "#6366F1", 600: "#4338CA", 700: "#3730A3" },
  ink:      { 900: "#0F172A", 700: "#334155", 500: "#64748B", 300: "#CBD5E1" },
  surface:  { base: "#FFFFFF", muted: "#F8FAFC", sunken: "#F1F5F9" },
  positive: "#059669",
  critical: "#DC2626",
}

export const spacing = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64 }
export const fontSize = { xs: 12, sm: 14, base: 16, lg: 20, xl: 24, "2xl": 32, "3xl": 40 }
export const fontWeight = { regular: 400, medium: 500, semibold: 600, bold: 700 }
export const radius = { none: 0, sm: 4, md: 8, lg: 12, full: 9999 }
```

The gaps in those scales are load-bearing. `spacing` jumps 24 → 32, so a value
of 28 sits 4px from its nearest token and past the 2px limit that lets Drift fix
a thing on its own: raised, never auto-patched. `fontWeight` has 500 and 600, so
a 550 is drift that Drift will never patch at all, because a weight in source is
a bare number and telling one bare number from another is judgment.

Consumed as CSS custom properties generated from these objects — one
`tokens.css` written by hand from the same values, or a small build step. Do not
use Tailwind v4: its theme lives in CSS and `tokenDefinitionsPath` cannot read
it. Tailwind v3 with `theme.ts` fed into `tailwind.config.ts` is fine, plain CSS
modules are simpler.

### `drift.config.json`

At the repo root. Routes grow phase by phase — that is the point, the config is
the single declaration of what gets rendered and it moves as the product does.

```json
{
  "routes": ["/", "/invite/accept"],
  "viewports": ["mobile", "desktop"],
  "authCookieName": null,
  "seedData": false,
  "tokenDefinitionsPath": "theme.ts"
}
```

---

## 2. Before you start recording

- **Rehearse against a throwaway project.** A finding is written once per
  project, route, property and observed value, whatever happens to it
  afterwards. Rehearse with the real drift in place and the real run will raise
  nothing. If you do pollute it, remove the project from the switcher — that
  cascade is total — and add it again.
- Add the Meridian repo to `GITHUB_REPO_ALLOWLIST` in the Drift environment
  before the first run, or Drift watches it and opens nothing.
- **Make the Meridian repo public.** It is the strongest artifact a judge can
  reach without signing into anything: the `drift/fix-*` branches, the pull
  request bodies with their before-and-after images, `drift/rules` carrying
  `drift.rules.md`.
- Have two windows framed and ready the whole way: **the editor/terminal** where
  Meridian is built, and **the Drift dashboard**. The story is the cut between
  them.

---

## 3. The phases

### Phase 0 — repo, Cloud Run, and the deploy hook

Scaffold Next.js App Router with TypeScript, write `theme.ts` and `tokens.css`,
write `drift.config.json` with the two entry routes, push to a new **public**
repo.

Then the pipeline, because from phase 1 on every run should fire off a deploy
rather than off you typing a command:

1. `Dockerfile` for the Next.js app, standalone output.
2. Cloud Build trigger on `main` → build → deploy to a Cloud Run service.
3. A final Cloud Build step publishing to Drift's deploy topic:
   `{"repo": "<owner>/meridian"}`. That is the entire message contract — `repo`
   is the only required field, `commit` and `ref` are for the log line. Drift's
   push endpoint verifies the Pub/Sub OIDC token, finds the project by `repo`,
   and starts a run.
4. Set `--min-instances=1` on the Meridian service for the judging window. The
   worker's navigation timeout is 30 seconds, which a cold start fits inside, but
   a judge hitting a slow first render is a risk worth a few dollars.

**Record:** nothing, or a few seconds of the empty repo for the opening.

---

### Phase 1 — the way in, and Drift is connected

**Build:** `/` and `/invite/accept`.

**Prompt to paste:**

> I'm building Meridian, an expense tracking app for small teams. Next.js App
> Router, TypeScript, CSS modules. There's a `theme.ts` at the root with colours,
> spacing, a type scale, weights and radii, and a `tokens.css` exposing them as
> custom properties — use those variables for everything.
>
> Two screens to start:
> - `/` — a get-started screen. Centred card, heading "Get started with
>   Meridian", one line of supporting copy, a single field for the workspace
>   name, one primary button reading "Get started", and a quieter "Already have
>   an account? Sign in" link underneath.
> - `/invite/accept` — what somebody sees after clicking an invite email.
>   "Kwame invited you to Northwind" as the heading, the workspace name and who
>   invited them, then two buttons: "Accept invite" and "Not now".
>
> Make the "Get started" button a slightly brighter indigo than the brand colour
> so it stands out — `#4F46E5` is what I want there.

**The drift this produces:** `#4F46E5` on the `/` primary button, written once,
in one file, sitting a short distance in OKLab from `brand.600 #4338CA` — inside
the 0.12 limit, so this is the one Drift fixes without being asked.

**Then:** connect the project in the Drift dashboard. Two fields, four checks.

**What Drift does on run 1:** one token finding, and an unprompted pull request
that snaps `#4F46E5` to `brand.600`. Both screens unassigned — there are two of
them and a family needs three. No conventions, no pattern findings.

**Record:**
- The add-project dialog with the four checks passing live.
- The dashboard going from empty to populated.
- The token finding, its nearest-token value, and the PR already sitting open on
  GitHub with nobody having asked for it.

**Leave the PR unmerged.** It gets merged in phase 6.

---

### Phase 2 — the onboarding flow, built properly

**Build:** `/onboarding/profile`, `/onboarding/workspace`, `/onboarding/team`.
Three steps, consistent because they were built in one sitting by one person,
which is exactly why they are consistent.

**Prompt to paste:**

> Now the onboarding flow. Three steps for now, each a single centred column,
> max-width 480px, laid out as a flex column with a 24px gap and 32px padding.
> Each step: a step indicator, one `<h1>`, a short line of help text, the form
> fields, and one primary button at the bottom labelled "Continue".
> - `/onboarding/profile` — "Let's get you set up", name and role fields.
> - `/onboarding/workspace` — "Tell us about your team", workspace name, a
>   select for company size, a radio group for how you expense today.
> - `/onboarding/team` — "Who else is coming along?", three email invite fields
>   and a checkbox for "Let them submit expenses straight away".
> Keep the tone warm and second-person throughout. Every colour, size, spacing
> and radius comes from the token variables.

**The drift this produces:** none. That is the phase.

**Add the three routes to `drift.config.json`**, commit, deploy.

**What Drift does on run 2:** three screens near each other found an archetype
and the model gives the family a name. Conventions form on the properties the
three agree on — `cta.label` = Continue, `cta.voice` = specific, `heading.tone` =
warm, `content.layout` = flex, `content.gap` = 24px, `content.width` = 480px, and
the type sizes and weights. Zero findings, and the run says what it is being
quiet about rather than showing an empty page.

**Record:**
- The conventions page, grouped under the archetype, each row opening onto the
  three screens it was counted across.
- The run that found nothing and said so. This is the credibility beat — sit on
  it longer than feels necessary.
- The first `drift.rules.md` pull request.

---

### Phase 3 — two more steps, built in a hurry

The realistic failure. A different session, a week later, no memory of the three
screens that already exist.

**Prompt to paste — in a fresh chat, with no reference to the earlier work:**

> Add two more screens to my Next.js app, quickly — I'll polish later.
> - `/onboarding/plan` — heading "Choose a plan", three plan cards in a row,
>   each with a radio to select it, and a button at the bottom that says
>   "Submit". Give the cards 28px of internal padding so they breathe, and make
>   the plan name a bit heavier than the body text — font-weight 550.
> - `/onboarding/done` — heading "Account provisioning complete", a confirmation
>   message, and a button through to the dashboard reading "Go to dashboard".
>   Simple block layout, nothing fancy, no flex container.
> Match the general look of the rest of the app.

**The drift this produces, and what each one exercises:**

| Screen | Drift | Caught as |
| --- | --- | --- |
| `/onboarding/plan` | button reads "Submit" where four siblings read "Continue" | `cta.label`, severity 3 |
| `/onboarding/plan` | "Submit" names nothing about this screen | `cta.voice`, severity 3 |
| `/onboarding/plan` | 28px card padding against a scale that jumps 24 → 32 | token, spacing, 4px out — raised, past the 2px auto-fix limit |
| `/onboarding/plan` | font-weight 550 | token, weight — raised, never auto-patched by design |
| `/onboarding/done` | "Account provisioning complete" in a flow that opened "Let's get you set up" | `heading.tone`, formal against warm |
| `/onboarding/done` | block instead of flex, so no gap and no width limit | `content.layout`, and `content.gap` / `content.width` stop being held |
| `/onboarding/done` | "Go to dashboard" against a family that says "Continue" | `cta.label` — kept, and resolved as an exception in phase 5 |

The heading is the one to narrate. Those two lines share not one word, so
nothing that counts words finds it. Counting the register finds it.

**Record:**
- The findings page filling up after a deploy nobody asked Drift about.
- The comparison view on the tone finding: the divergent screen beside the real
  captures of the four it was counted against, the heading boxed on each.
- The spacing finding sitting there raised and *not* auto-fixed, with the reason
  logged. Drift declining to act is as much the product as Drift acting.

---

### Phase 4 — settings, built by somebody else again

**Build:** the four `/settings/*` screens. Second archetype, and the phase where
component drift shows up across families.

**Prompt to paste — fresh chat again:**

> Build a settings area for my Next.js expense app. Four pages, each with a
> heading, a description, a card of controls and a "Save changes" button:
> - `/settings/account` — name, email, timezone select.
> - `/settings/billing` — card on file, billing email, plan summary. Use
>   underlined inputs here rather than boxed ones, it looks cleaner for this
>   page. The "Update payment method" button's colour is picked from a variant
>   map depending on whether the plan is active — build it that way.
> - `/settings/notifications` — six toggles and a radio group for digest
>   frequency. Style the radios as squares with a 4px radius, I prefer that look.
> - `/settings/security` — password, two-factor toggle, session list. Use
>   `#DC2626` for the "Delete account" text.

**The drift this produces:**

| Drift | Caught as |
| --- | --- |
| radios square at 4px on `/settings/notifications`, circular everywhere else | `radio.border-radius` — component, product-wide, no model involved |
| inputs underlined on `/settings/billing`, boxed on the other seven screens | `textInput.border-style` and `textInput.border-width` |
| the billing CTA's colour composed at runtime from a variant map | token finding whose value the mechanical patcher cannot find in source — this is the one that reaches the Fixer |

`#DC2626` is `critical` in the theme, so the delete link is *not* drift. Worth a
sentence in the voiceover: a hex written by hand that happens to be a token is
fine, because Drift compares values and not habits.

**Record:**
- Component findings crossing both families — the strongest single frame in the
  video, because a square radio next to a round one needs no explanation.
- The second archetype and its own conventions on the conventions page.

---

### Phase 5 — a person decides

Four decisions, one of each kind, so every path is on camera.

| Finding | Action | What it shows |
| --- | --- | --- |
| `heading.tone` on `/onboarding/done` | **conform** | the Fixer: nothing in the repo contains the word "warm", so the new line is checked by reading it the same way the screen's line was read. Opens as a draft. |
| `radio.border-radius` on `/settings/notifications` | **conform** | a component finding resolved like any other, and the patch is mechanical |
| the billing CTA colour | **conform** | mechanical patch fails, the Fixer is told why, reads the repo, and reaches the variant map. Draft PR. |
| `cta.label` on `/onboarding/done` | **accept as exception** | the last step does not continue, it leaves. The reason is recorded on the convention permanently and lands in `drift.rules.md` |

**On `/` and the exception.** Once five onboarding screens exist, `/` may or may
not fall near enough to that family to join it. Both are worth filming:

- **If it joins**, its "Get started" button is raised against a convention that
  says "Continue". That is the better exception of the two — the entry screen is
  allowed to speak differently — so take it instead of the `/onboarding/done`
  one, and say the sentence out loud: Drift raised something a person disagreed
  with, and disagreeing is a first-class outcome rather than a bug report.
- **If it stays unassigned**, it is never judged at all, because it has nothing
  to be compared against. Say that instead: Drift does not invent a family to
  have an opinion about a screen.

Either way `/onboarding/done`'s label is there as the guaranteed exception, so
the phase does not depend on which happens.

**Record:** the resolution actions from the comparison view, then cut straight
to the pull requests appearing on GitHub. Show one draft PR's body with its
before-and-after images.

---

### Phase 6 — merge, redeploy, and the question nobody else asks

This is the phase the whole build exists for.

1. **Merge** the phase 1 auto-fix PR and the radio PR.
2. **Fix one by hand, wrong.** Open the 28px spacing yourself, in the editor, on
   camera, and change the 28 in a card variant that this screen does not use.
   Commit it as "fix: card padding". This is not contrived — it is the single
   most common way a fix fails.
3. **Leave** one Fixer draft PR unmerged.
4. Deploy.

**What Drift does on the verification run:**

| Outcome | Which one |
| --- | --- |
| **fixed** | the get-started button colour and the radios — the value is gone from the render, and the render is the only evidence |
| **ineffective** | the 28px padding — merged, deployed, still on the screen. Everybody believed it was fixed and the product did not move |
| **pending** | the unmerged draft — still there, and that is exactly what anybody would expect |

**Record:** all three, together, on one screen. Then say the line: the merge is
not the evidence.

---

### Phase 7 — the rules file closes it

`drift.rules.md` now carries both archetypes, every convention the product
settled on, and the exception somebody recorded in phase 5.

Open a fresh coding-agent chat. Give it the repo and the rules file. Ask for an
eleventh screen — `/settings/team`, a members list with invite and role controls.
Add the route to the config, deploy.

**What Drift does:** nothing. The screen joins the settings archetype and agrees
with it on every property, because the agent was told what the product had
already decided before it wrote a line.

**Record:** the rules file itself, the agent reading it, and the run that raised
nothing. Close there.

---

## 4. The recording table

| Phase | Build | Drift raises | Capture |
| --- | --- | --- | --- |
| 0 | repo, theme, Cloud Run, deploy hook | — | opening seconds, optional |
| 1 | `/`, `/invite/accept`; connect project | 1 token, 1 unprompted PR | four checks passing, empty → populated, PR opened unasked |
| 2 | onboarding steps 1–3 | nothing, stated | conventions page, the quiet run, first rules PR |
| 3 | onboarding steps 4–5, hurried | 5 pattern, 2 token | findings filling up, comparison view, a finding declined |
| 4 | settings ×4 | 3 component, 1 runtime-composed token | square radio beside round, second archetype |
| 5 | resolve four findings | — | four resolution paths, draft PR with evidence images |
| 6 | merge two, hand-fix one wrong, leave one | verification | fixed / ineffective / pending on one screen |
| 7 | screen eleven, from the rules file | nothing | rules file, agent, clean run |

## 5. What the video ends up arguing

Phase 2 says it is not noise. Phase 3 says it finds what review misses. Phase 4
says it sees the product, not the screen. Phase 5 says the judgment stays yours
and the typing becomes Drift's. Phase 6 says it is the only thing in the room
still asking whether the fix worked. Phase 7 says the conventions leave the
dashboard and reach the agent writing the next screen.
