/**
 * Six steps of one onboarding flow, as the render and extraction phases would
 * leave them, with two divergences planted on the last step:
 *
 *   - its action says "Next" where four siblings say "Continue" and one says
 *     "Get started",
 *   - its heading renders at 20px where five siblings render at 24px.
 *
 * Everything that reads this fixture asserts exactly those two. A change that
 * starts finding a third has broken something, and a change that stops finding
 * one of these has broken something worse.
 */

import { buildSignature, type ComputedStyles, type Screen, type ScreenText, type StyleValues } from "@drift/core"

/** Steps of the flow, one per route. */
export const STEP_COUNT = 6

/** What the last step's action says. */
export const PLANTED_LABEL = "Next"

/** What its siblings say, and therefore what the convention is. */
export const CONVENTION_LABEL = "Continue"

/** The heading size the last step renders. */
export const PLANTED_HEADING_SIZE = "20px"

/** The heading size its siblings render. */
export const CONVENTION_HEADING_SIZE = "24px"

export const HEADING_SELECTOR = "[data-testid='step'] > h1:nth-of-type(1)"
export const BACK_SELECTOR = "[data-testid='back']"
export const NEXT_SELECTOR = "[data-testid='next']"

function styles(overrides: Partial<StyleValues> = {}): StyleValues {
  return {
    color: "rgb(15, 23, 42)",
    "background-color": "rgba(0, 0, 0, 0)",
    "font-size": "16px",
    "font-weight": "400",
    "line-height": "24px",
    margin: "0px",
    padding: "0px",
    "border-radius": "0px",
    "box-shadow": "none",
    ...overrides,
  }
}

/** The action label each step renders. Step 6 is the one that drifted. */
export function stepLabel(step: number): string {
  if (step === STEP_COUNT) return PLANTED_LABEL
  return step === 1 ? "Get started" : CONVENTION_LABEL
}

/** The heading size each step renders. */
export function stepHeadingSize(step: number): string {
  return step === STEP_COUNT ? PLANTED_HEADING_SIZE : CONVENTION_HEADING_SIZE
}

export function stepStyles(step: number): ComputedStyles {
  return {
    body: {
      tag: "body",
      box: { x: 0, y: 0, width: 390, height: 844 },
      styles: styles({ "background-color": "rgb(255, 255, 255)" }),
    },
    "[data-testid='step']": {
      tag: "section",
      box: { x: 0, y: 0, width: 390, height: 844 },
      styles: styles({ padding: "24px 16px" }),
    },
    [HEADING_SELECTOR]: {
      tag: "h1",
      box: { x: 16, y: 96, width: 358, height: 32 },
      styles: styles({
        "font-size": stepHeadingSize(step),
        "font-weight": "700",
        "line-height": "32px",
      }),
    },
    "[data-testid='step'] > p:nth-of-type(1)": {
      tag: "p",
      box: { x: 16, y: 144, width: 358, height: 24 },
      styles: styles({ color: "rgb(100, 116, 139)" }),
    },
    [BACK_SELECTOR]: {
      tag: "button",
      box: { x: 16, y: 700, width: 88, height: 44 },
      styles: styles({ "font-weight": "500", padding: "12px 16px", "border-radius": "8px" }),
    },
    [NEXT_SELECTOR]: {
      tag: "button",
      box: { x: 214, y: 700, width: 160, height: 44 },
      styles: styles({
        color: "rgb(255, 255, 255)",
        "background-color": "rgb(79, 70, 229)",
        "font-weight": "500",
        padding: "12px 24px",
        "border-radius": "8px",
      }),
    },
  }
}

export function stepText(step: number): ScreenText {
  return {
    [HEADING_SELECTOR]: `Step ${step}`,
    "[data-testid='step'] > p:nth-of-type(1)": "A short line about this step.",
    [BACK_SELECTOR]: "Back",
    [NEXT_SELECTOR]: stepLabel(step),
  }
}

export function stepRoute(step: number): string {
  return `/onboarding/${step}`
}

/** One step as a stored screen, signed the way the run signs it. */
export function stepScreen(step: number, overrides: Partial<Screen> = {}): Screen {
  const computedStyles = stepStyles(step)
  const text = stepText(step)
  const route = stepRoute(step)

  return {
    id: `screen${step}`,
    projectId: "proj1",
    route,
    viewport: "mobile",
    runId: "run1",
    screenshotPath: `gs://bucket/proj1/run1${route}-mobile.png`,
    computedStyles,
    text,
    signature: buildSignature({ route, viewport: "mobile", computedStyles, text }),
    archetypeId: "arch1",
    embedding: null,
    capturedAt: new Date("2026-08-07T10:00:00Z"),
    ...overrides,
  }
}

/** The whole flow, step 1 first. */
export function stepScreens(): Screen[] {
  return Array.from({ length: STEP_COUNT }, (_unused, index) => stepScreen(index + 1))
}
