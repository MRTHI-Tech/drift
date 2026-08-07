import { describe, expect, it } from "vitest"

import { divergenceCandidates } from "./divergence"
import { HEADING_SELECTOR, NEXT_SELECTOR, stepScreen, stepScreens } from "./fixtures"
import { extractionSlice, latestPerRoute, uniqueLabel } from "./judge-run"
import { buildProfile } from "./profile"

const screen = stepScreen(6)
const profile = buildProfile({
  signature: screen.signature!,
  computedStyles: screen.computedStyles,
  text: screen.text,
})

const conventions = [
  {
    id: "conv1",
    projectId: "proj1",
    archetypeId: "arch1",
    property: "cta.label",
    value: "Continue",
    label: "Steps end with Continue",
    confidence: "medium" as const,
    evidenceScreenIds: ["screen2", "screen3", "screen4", "screen5"],
    exceptions: [],
    status: "derived" as const,
    updatedAt: new Date("2026-08-07T10:00:00Z"),
  },
]

describe("extractionSlice", () => {
  it("carries the cited elements and nothing else", () => {
    const candidates = divergenceCandidates({ screenId: screen.id, profile, conventions })
    const slice = extractionSlice(screen, candidates)

    expect(Object.keys(slice.computedStyles)).toEqual([NEXT_SELECTOR])
    expect(slice.text[NEXT_SELECTOR]).toBe("Next")
    expect(slice.computedStyles[HEADING_SELECTOR]).toBeUndefined()
  })

  it("carries the children a label is rendered from", () => {
    const text = { ...screen.text }
    delete text[NEXT_SELECTOR]
    text[`${NEXT_SELECTOR} > span:nth-of-type(1)`] = "Next"

    const withSpan = stepScreen(6, { text })
    const candidates = divergenceCandidates({
      screenId: withSpan.id,
      profile: buildProfile({
        signature: withSpan.signature!,
        computedStyles: withSpan.computedStyles,
        text,
      }),
      conventions,
    })

    const slice = extractionSlice(withSpan, candidates)

    expect(slice.text[`${NEXT_SELECTOR} > span:nth-of-type(1)`]).toBe("Next")
  })

  it("is empty when there is nothing to judge", () => {
    expect(extractionSlice(screen, [])).toEqual({ computedStyles: {}, text: {} })
  })
})

describe("latestPerRoute", () => {
  it("keeps one screen per route and viewport", () => {
    const flow = stepScreens()
    const rerun = flow.map((captured) => ({
      ...captured,
      id: `${captured.id}-rerun`,
      runId: "run2",
      capturedAt: new Date("2026-08-08T10:00:00Z"),
    }))

    const kept = latestPerRoute([...flow, ...rerun])

    expect(kept).toHaveLength(6)
    expect(kept.every((captured) => captured.runId === "run2")).toBe(true)
  })

  it("keeps the same route at two viewports apart", () => {
    const mobile = stepScreen(1)
    const desktop = stepScreen(1, { id: "screen1-desktop", viewport: "desktop" })

    expect(latestPerRoute([mobile, desktop])).toHaveLength(2)
  })

  it("orders by route, so a run always derives in the same order", () => {
    const flow = stepScreens()

    expect(latestPerRoute([...flow].reverse()).map((captured) => captured.route)).toEqual(
      flow.map((captured) => captured.route),
    )
  })
})

describe("uniqueLabel", () => {
  it("takes the model's label when nothing else holds it", () => {
    expect(uniqueLabel("Onboarding step", "mobile", new Set())).toBe("Onboarding step")
  })

  it("disambiguates a repeat by viewport rather than by a number", () => {
    expect(uniqueLabel("Onboarding step", "desktop", new Set(["Onboarding step"]))).toBe(
      "Onboarding step (desktop)",
    )
  })

  it("falls back to a number only when the viewport is taken too", () => {
    const inUse = new Set(["Onboarding step", "Onboarding step (desktop)"])

    expect(uniqueLabel("Onboarding step", "desktop", inUse)).toBe("Onboarding step (desktop) 2")
  })

  it("names an archetype the model would not name", () => {
    expect(uniqueLabel("   ", "mobile", new Set())).toBe("Unnamed screen")
  })
})
