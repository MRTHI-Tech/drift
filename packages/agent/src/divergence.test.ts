import type { Convention } from "@drift/core"
import { describe, expect, it } from "vitest"

import { deriveConventionProposals } from "./conventions"
import { divergenceCandidates } from "./divergence"
import {
  CONVENTION_HEADING_SIZE,
  CONVENTION_LABEL,
  HEADING_SELECTOR,
  NEXT_SELECTOR,
  PLANTED_HEADING_SIZE,
  PLANTED_LABEL,
  stepScreen,
  stepScreens,
} from "./fixtures"
import { buildProfile, type ProfiledScreen } from "./profile"

function profiled(): ProfiledScreen[] {
  return stepScreens().map((screen) => ({
    screenId: screen.id,
    route: screen.route,
    profile: buildProfile({
      signature: screen.signature!,
      computedStyles: screen.computedStyles,
      text: screen.text,
    }),
  }))
}

/** The flow's conventions, as `deriveAll` would have stored them. */
function conventions(): Convention[] {
  return deriveConventionProposals(profiled()).map((proposal, index) => ({
    id: `conv${index + 1}`,
    projectId: "proj1",
    archetypeId: "arch1",
    property: proposal.property,
    value: proposal.value,
    label: `${proposal.property} is ${proposal.value}`,
    confidence: proposal.confidence,
    evidenceScreenIds: proposal.evidenceScreenIds,
    exceptions: [],
    status: "derived" as const,
    updatedAt: new Date("2026-08-07T10:00:00Z"),
  }))
}

const lastStep = stepScreen(6)
const lastProfile = buildProfile({
  signature: lastStep.signature!,
  computedStyles: lastStep.computedStyles,
  text: lastStep.text,
})

describe("divergenceCandidates", () => {
  it("finds exactly the two planted divergences on the last step", () => {
    const candidates = divergenceCandidates({
      screenId: lastStep.id,
      profile: lastProfile,
      conventions: conventions(),
    })

    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toMatchObject({
      property: "cta.label",
      selector: NEXT_SELECTOR,
      observedValue: PLANTED_LABEL,
      expectedValue: CONVENTION_LABEL,
      severity: 3,
    })
    expect(candidates[0]?.siblingScreenIds).toEqual([
      "screen2",
      "screen3",
      "screen4",
      "screen5",
    ])
    expect(candidates[1]).toMatchObject({
      property: "heading.size",
      selector: HEADING_SELECTOR,
      observedValue: PLANTED_HEADING_SIZE,
      expectedValue: CONVENTION_HEADING_SIZE,
      severity: 2,
    })
  })

  it("finds nothing on a step that agrees with its siblings", () => {
    const third = stepScreen(3)
    const profile = buildProfile({
      signature: third.signature!,
      computedStyles: third.computedStyles,
      text: third.text,
    })

    expect(
      divergenceCandidates({ screenId: third.id, profile, conventions: conventions() }),
    ).toEqual([])
  })

  it("never raises a screen against a convention it is evidence for", () => {
    const first = stepScreen(1)
    const profile = buildProfile({
      signature: first.signature!,
      computedStyles: first.computedStyles,
      text: first.text,
    })

    // Step 1 says Get started, so it diverges on the label but is evidence for
    // the heading size, and the heading size is therefore never raised on it.
    const candidates = divergenceCandidates({
      screenId: first.id,
      profile,
      conventions: conventions(),
    })

    expect(candidates.map((candidate) => candidate.property)).toEqual(["cta.label"])
  })

  it("respects an exception permanently", () => {
    const withException = conventions().map((convention) =>
      convention.property === "cta.label"
        ? {
            ...convention,
            exceptions: [{ screenId: lastStep.id, reason: "The last step ends the flow." }],
          }
        : convention,
    )

    const candidates = divergenceCandidates({
      screenId: lastStep.id,
      profile: lastProfile,
      conventions: withException,
    })

    expect(candidates.map((candidate) => candidate.property)).toEqual(["heading.size"])
  })

  it("says nothing about a convention the user removed", () => {
    const removed = conventions().map((convention) =>
      convention.property === "heading.size"
        ? { ...convention, status: "removed" as const }
        : convention,
    )

    const candidates = divergenceCandidates({
      screenId: lastStep.id,
      profile: lastProfile,
      conventions: removed,
    })

    expect(candidates.map((candidate) => candidate.property)).toEqual(["cta.label"])
  })

  it("carries the convention's own name as the expected source", () => {
    const candidates = divergenceCandidates({
      screenId: lastStep.id,
      profile: lastProfile,
      conventions: conventions(),
    })

    expect(candidates[0]?.expectedSource).toBe("cta.label is Continue")
    expect(candidates[0]?.conventionId).toBe("conv1")
  })
})
