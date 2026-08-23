/**
 * A watched repo and two findings against it, as fixtures.
 *
 * The source below plants exactly what the phase is built to act on: one
 * hardcoded colour written once, and one action label written once. It also
 * plants the things that must not be touched, a `Next.js` in a comment and a
 * `#ff000011` that only starts the same way, so a test that starts patching
 * either of them has broken the bounding rules in `patch.ts`.
 */

import type { SourceFile } from "../github"
import type { Convention, Finding, Project, Screen, Signature } from "../types"

/** The hardcoded colour, as Chromium reports it and as the repo writes it. */
export const PLANTED_HEX = "#FF0000"
export const PLANTED_RGB = "rgb(255, 0, 0)"

/** The token it missed. */
export const NEAREST_TOKEN = { name: "colors.danger.500", value: "#EF4444" }

export const PROJECT: Project = {
  id: "proj1",
  userId: "user1",  name: "Acme",
  repo: "acme/web",
  previewUrl: "https://acme-preview.a.run.app",
  defaultBranch: "main",
  configPath: "drift.config.json",
  installationId: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  driftScore: 82,
  lastRunAt: new Date("2026-08-07T10:00:00Z"),
}

/** The watched repo's source, as `fetchSourceFiles` returns it. */
export const SOURCE_FILES: SourceFile[] = [
  {
    path: "app/pricing/page.tsx",
    text: `// Pricing page. Built with Next.js and the Acme theme.
import { theme } from "@/theme"

export default function Pricing() {
  return (
    <main style={{ borderTop: "1px solid #ff000011" }}>
      <h1 className="text-2xl">Pricing</h1>
      <button style={{ backgroundColor: "${PLANTED_HEX}", padding: "13px" }}>Next</button>
    </main>
  )
}
`,
  },
  {
    path: "app/checkout/step-2.tsx",
    text: `export function StepTwo() {
  return (
    <form>
      <h2>Payment</h2>
      <button type="submit">Continue</button>
    </form>
  )
}
`,
  },
  {
    path: "theme.ts",
    text: `export const colors = {
  danger: { 500: "${NEAREST_TOKEN.value}" },
  brand: { 500: "#4F46E5" },
}
`,
  },
]

/** A token finding: the hardcoded colour, on the pricing page. */
export const TOKEN_FINDING: Finding = {
  id: "finding-token",
  projectId: PROJECT.id,
  runId: "run1",
  type: "token",
  screenId: "screen-pricing",
  conventionId: null,
  evidence: {
    selector: "[data-testid='plan-cta']",
    property: "background-color",
    observedValue: PLANTED_RGB,
    expectedValue: NEAREST_TOKEN.value,
    expectedSource: NEAREST_TOKEN.name,
    siblingScreenIds: [],
    sentence: null,
  },
  severity: 3,
  status: "open",
  dedupeKey: "a".repeat(64),
  prNumber: null,
  createdAt: new Date("2026-08-07T10:00:00Z"),
  resolvedAt: null,
}

/** A pattern finding: the screen says Next where its siblings say Continue. */
export const PATTERN_FINDING: Finding = {
  id: "finding-pattern",
  projectId: PROJECT.id,
  runId: "run1",
  type: "pattern",
  screenId: "screen-pricing",
  conventionId: "convention-cta-label",
  evidence: {
    selector: "[data-testid='plan-cta']",
    property: "cta.label",
    observedValue: "Next",
    expectedValue: "Continue",
    expectedSource: "the last action says Continue",
    siblingScreenIds: ["screen-step-1", "screen-step-2", "screen-step-3", "screen-step-4"],
    sentence: "This screen says Next. 4 sibling screens say Continue.",
  },
  severity: 3,
  status: "open",
  dedupeKey: "b".repeat(64),
  prNumber: null,
  createdAt: new Date("2026-08-07T10:00:00Z"),
  resolvedAt: null,
}

/** The convention the pattern finding answers to. */
export const CTA_LABEL_CONVENTION: Convention = {
  id: "convention-cta-label",
  projectId: PROJECT.id,
  archetypeId: "archetype-checkout",
  property: "cta.label",
  value: "Continue",
  label: "the last action says Continue",
  confidence: "high",
  evidenceScreenIds: ["screen-step-1", "screen-step-2", "screen-step-3", "screen-step-4"],
  exceptions: [],
  status: "derived",
  updatedAt: new Date("2026-08-07T10:00:00Z"),
}

/** A heading convention, so the rules file has a type section to write. */
export const HEADING_SIZE_CONVENTION: Convention = {
  ...CTA_LABEL_CONVENTION,
  id: "convention-heading-size",
  property: "heading.size",
  value: "24px",
  label: "headings are 24px",
  confidence: "medium",
  exceptions: [],
}

/**
 * A component convention, product-wide, so the rules file has one to state
 * without an archetype behind it.
 */
export const BUTTON_RADIUS_CONVENTION: Convention = {
  ...CTA_LABEL_CONVENTION,
  id: "convention-button-radius",
  archetypeId: null,
  property: "button.border-radius",
  value: "999px",
  label: "Buttons have a corner radius of 999px",
  confidence: "high",
  exceptions: [],
}

/** A signature carrying only the copy tallies the rules file reads. */
export function signatureWithCopy(overrides: Partial<Signature["copy"]> = {}): Signature {
  const tally = {
    count: 4,
    sentence: 4,
    title: 0,
    upper: 0,
    lower: 0,
    other: 0,
    imperative: 3,
    dominantCase: "sentence" as const,
  }

  return {
    route: "/checkout/step-2",
    viewport: "mobile",
    interactive: [],
    typeHierarchy: [],
    sectionCount: 3,
    verticalRhythm: [],
    copy: { labels: tally, headings: { ...tally, imperative: 0 }, ...overrides },
    structureHash: "0".repeat(64),
    tokenHash: "0".repeat(64),
  }
}

/** One stored screen, enough for the parts of actuation that read one. */
export function screen(overrides: Partial<Screen> = {}): Screen {
  return {
    id: "screen-pricing",
    projectId: PROJECT.id,
    route: "/pricing",
    viewport: "mobile",
    runId: "run1",
    screenshotPath: "gs://drift-shots/proj1/run1/pricing-mobile.png",
    computedStyles: {},
    text: {},
    signature: signatureWithCopy(),
    archetypeId: "archetype-checkout",
    embedding: null,
    capturedAt: new Date("2026-08-07T10:00:00Z"),
    ...overrides,
  }
}
