import { MIN_SCREENS_PER_CONVENTION } from "@drift/core"
import { describe, expect, it } from "vitest"

import { deriveConventionProposals } from "./conventions"
import { confidenceOf } from "@drift/core"
import {
  CONVENTION_HEADING_SIZE,
  CONVENTION_LABEL,
  stepScreens,
  type stepScreen,
} from "./fixtures"
import { buildProfile, type ProfiledScreen } from "./profile"

function profiled(screens: ReturnType<typeof stepScreen>[]): ProfiledScreen[] {
  return screens.map((screen) => ({
    screenId: screen.id,
    route: screen.route,
    profile: buildProfile({
      signature: screen.signature!,
      computedStyles: screen.computedStyles,
      text: screen.text,
    }),
  }))
}

const flow = profiled(stepScreens())

describe("deriveConventionProposals", () => {
  it("derives what the flow agrees on, with the screens that prove it", () => {
    const byProperty = new Map(
      deriveConventionProposals(flow).map((proposal) => [proposal.property, proposal]),
    )

    expect(byProperty.get("cta.label")).toMatchObject({
      value: CONVENTION_LABEL,
      // Four of six steps say Continue. One says Get started, one says Next.
      evidenceScreenIds: ["screen2", "screen3", "screen4", "screen5"],
      consideredScreens: 6,
    })
    expect(byProperty.get("heading.size")).toMatchObject({
      value: CONVENTION_HEADING_SIZE,
      evidenceScreenIds: ["screen1", "screen2", "screen3", "screen4", "screen5"],
      consideredScreens: 6,
    })
  })

  it("states a property the whole flow shares", () => {
    const radius = deriveConventionProposals(flow).find(
      (proposal) => proposal.property === "cta.radius",
    )

    expect(radius).toMatchObject({ value: "8px", confidence: "high" })
    expect(radius?.evidenceScreenIds).toHaveLength(6)
  })

  it("states nothing at all below the floor of three agreeing screens", () => {
    const twoStepFlow = flow.slice(1, 3)

    expect(twoStepFlow).toHaveLength(2)
    expect(MIN_SCREENS_PER_CONVENTION).toBe(3)
    expect(deriveConventionProposals(twoStepFlow)).toEqual([])
  })

  it("states nothing when two values tie for first", () => {
    // Three screens saying Continue, three saying Get started: the family has
    // not settled, so there is no convention to state.
    const tied = profiled(stepScreens()).slice(0, 6)
    for (const screen of tied.slice(0, 3)) {
      const label = screen.profile.find((value) => value.property === "cta.label")!
      label.value = "Get started"
    }
    for (const screen of tied.slice(3)) {
      const label = screen.profile.find((value) => value.property === "cta.label")!
      label.value = "Continue"
    }

    const label = deriveConventionProposals(tied).find(
      (proposal) => proposal.property === "cta.label",
    )

    expect(label).toBeUndefined()
  })

  it("ignores screens that hold no value for a property", () => {
    const partial = profiled(stepScreens())
    for (const screen of partial.slice(3)) {
      screen.profile = screen.profile.filter((value) => value.property !== "heading.size")
    }

    const heading = deriveConventionProposals(partial).find(
      (proposal) => proposal.property === "heading.size",
    )

    // Three unanimous screens is the floor, not a standard: high confidence
    // wants four or more.
    expect(heading).toMatchObject({ consideredScreens: 3, confidence: "medium" })
    expect(heading?.evidenceScreenIds).toHaveLength(3)
  })
})

describe("confidenceOf", () => {
  it("is high when almost the whole family agrees", () => {
    expect(confidenceOf(5, 6)).toBe("high")
    expect(confidenceOf(6, 6)).toBe("high")
  })

  it("is medium when most of it does", () => {
    expect(confidenceOf(4, 6)).toBe("medium")
    expect(confidenceOf(3, 5)).toBe("medium")
  })

  it("is low when the value is only a plurality", () => {
    expect(confidenceOf(3, 8)).toBe("low")
  })
})
