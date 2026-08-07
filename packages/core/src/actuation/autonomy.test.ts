import { describe, expect, it } from "vitest"

import type { SourceFile } from "../github"
import { isAutonomousFix } from "./autonomy"
import { MAX_AUTONOMOUS_DISTANCE } from "./constants"
import { PATTERN_FINDING, SOURCE_FILES, TOKEN_FINDING } from "./fixtures"
import { planFindingPatch } from "./patch"

/** The one case that qualifies, which every other case here is a change to. */
function qualifying(files: SourceFile[] = SOURCE_FILES) {
  return {
    finding: TOKEN_FINDING,
    plan: planFindingPatch(TOKEN_FINDING, "conform", files),
    nearestTokenDistance: 0.05,
  }
}

describe("isAutonomousFix", () => {
  it("opens a single close token substitution unprompted", () => {
    const decision = isAutonomousFix(qualifying())

    expect(decision.autonomous).toBe(true)
    expect(decision.reason).toContain("app/pricing/page.tsx")
  })

  it("always gives a reason, either way", () => {
    expect(qualifying().plan.blocked).toBeNull()
    expect(isAutonomousFix(qualifying()).reason.length).toBeGreaterThan(0)
  })

  it("never acts on pattern drift, whatever the patch looks like", () => {
    const decision = isAutonomousFix({
      finding: PATTERN_FINDING,
      plan: planFindingPatch(PATTERN_FINDING, "conform", SOURCE_FILES),
      nearestTokenDistance: 0,
    })

    expect(decision.autonomous).toBe(false)
    expect(decision.reason).toMatch(/judgment about the product/)
  })

  it("leaves a finding somebody has already decided about alone", () => {
    for (const status of ["dismissed", "resolved_conform", "resolved_exception"] as const) {
      const decision = isAutonomousFix({
        ...qualifying(),
        finding: { ...TOKEN_FINDING, status },
      })

      expect(decision.autonomous).toBe(false)
      expect(decision.reason).toContain(status)
    }
  })

  it("does not open a second pull request for a finding that has one", () => {
    const decision = isAutonomousFix({
      ...qualifying(),
      finding: { ...TOKEN_FINDING, prNumber: 12 },
    })

    expect(decision.autonomous).toBe(false)
    expect(decision.reason).toContain("12")
  })

  it("needs a named token to substitute", () => {
    const decision = isAutonomousFix({
      ...qualifying(),
      finding: {
        ...TOKEN_FINDING,
        evidence: { ...TOKEN_FINDING.evidence, expectedSource: null, expectedValue: "" },
      },
    })

    expect(decision.autonomous).toBe(false)
    expect(decision.reason).toMatch(/no scale/)
  })

  it("refuses a value that is written more than once", () => {
    const twice: SourceFile[] = [
      ...SOURCE_FILES,
      { path: "app/about.tsx", text: `const brand = "#FF0000"\n` },
    ]

    const decision = isAutonomousFix(qualifying(twice))

    expect(decision.autonomous).toBe(false)
    expect(decision.reason).toMatch(/appears 2 times/)
  })

  it("refuses a value sitting too far from the token it would be snapped to", () => {
    const decision = isAutonomousFix({
      ...qualifying(),
      nearestTokenDistance: MAX_AUTONOMOUS_DISTANCE.color + 0.01,
    })

    expect(decision.autonomous).toBe(false)
    expect(decision.reason).toMatch(/a choice somebody made/)
  })

  it("refuses when the distance is not known at all", () => {
    const decision = isAutonomousFix({ ...qualifying(), nearestTokenDistance: null })

    expect(decision.autonomous).toBe(false)
    expect(decision.reason).toMatch(/not known/)
  })

  it("never acts on a font weight, which is a bare number in source", () => {
    const weight = {
      ...TOKEN_FINDING,
      evidence: { ...TOKEN_FINDING.evidence, property: "font-weight", observedValue: "550" },
    }

    const decision = isAutonomousFix({
      finding: weight,
      plan: planFindingPatch(weight, "conform", SOURCE_FILES),
      nearestTokenDistance: 50,
    })

    expect(decision.autonomous).toBe(false)
    expect(decision.reason).toMatch(/font-weight/)
  })

  it("refuses a patch that could not be planned", () => {
    const decision = isAutonomousFix(qualifying([SOURCE_FILES[2]!]))

    expect(decision.autonomous).toBe(false)
    expect(decision.reason).toMatch(/No source file writes/)
  })
})
