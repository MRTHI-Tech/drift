/**
 * The reconciliation gate (AGENTS.md section 3). If any test in this file has
 * to be relaxed to make a change pass, the change is wrong.
 */

import { describe, expect, it } from "vitest"

import { divergenceCandidates } from "./divergence"
import type { DivergenceCandidate } from "./divergence"
import {
  HEADING_SELECTOR,
  NEXT_SELECTOR,
  PLANTED_HEADING_SIZE,
  PLANTED_LABEL,
  stepScreen,
} from "./fixtures"
import { buildProfile } from "./profile"
import { plainSentence, reconcile, valueIsRecorded, type Assessment } from "./reconcile"

const screen = stepScreen(6)
const profile = buildProfile({
  signature: screen.signature!,
  computedStyles: screen.computedStyles,
  text: screen.text,
})

const extraction = { computedStyles: screen.computedStyles, text: screen.text }

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
  {
    id: "conv2",
    projectId: "proj1",
    archetypeId: "arch1",
    property: "heading.size",
    value: "24px",
    label: "Step headings are 24px",
    confidence: "high" as const,
    evidenceScreenIds: ["screen1", "screen2", "screen3", "screen4", "screen5"],
    exceptions: [],
    status: "derived" as const,
    updatedAt: new Date("2026-08-07T10:00:00Z"),
  },
]

const candidates = divergenceCandidates({ screenId: screen.id, profile, conventions })

/** What an honest model returns: the values it was given, unchanged. */
function honest(index: number, sentence: string): Assessment {
  const candidate = candidates[index]!
  return {
    candidateIndex: index,
    material: true,
    citedSelector: candidate.selector,
    citedProperty: candidate.property,
    citedValue: candidate.observedValue,
    sentence,
  }
}

describe("valueIsRecorded", () => {
  it("finds a style value the screen really renders", () => {
    expect(
      valueIsRecorded(extraction, "style", HEADING_SELECTOR, "heading.size", PLANTED_HEADING_SIZE),
    ).toBe(true)
  })

  it("finds a copy value the screen really says", () => {
    expect(valueIsRecorded(extraction, "copy", NEXT_SELECTOR, "cta.label", PLANTED_LABEL)).toBe(
      true,
    )
  })

  it("refuses a value the screen does not render", () => {
    expect(
      valueIsRecorded(extraction, "style", HEADING_SELECTOR, "heading.size", "18px"),
    ).toBe(false)
    expect(valueIsRecorded(extraction, "copy", NEXT_SELECTOR, "cta.label", "Proceed")).toBe(false)
  })

  it("refuses a real value read off the wrong element", () => {
    // 20px is on the heading, not on the button.
    expect(
      valueIsRecorded(extraction, "style", NEXT_SELECTOR, "heading.size", PLANTED_HEADING_SIZE),
    ).toBe(false)
  })

  it("refuses an element the record does not hold", () => {
    expect(
      valueIsRecorded(extraction, "style", "[data-testid='ghost']", "heading.size", "24px"),
    ).toBe(false)
  })

  it("refuses a property Drift does not read", () => {
    expect(valueIsRecorded(extraction, "style", HEADING_SELECTOR, "heading.mood", "calm")).toBe(
      false,
    )
  })
})

describe("reconcile", () => {
  it("keeps both findings when the model cites what is really there", () => {
    const result = reconcile({
      candidates,
      assessments: [
        honest(0, "This screen says Next. 4 sibling screens say Continue."),
        honest(1, "This screen's heading is 20px. 5 sibling screens use 24px."),
      ],
      extraction,
    })

    expect(result.dropped).toBe(0)
    expect(result.droppedOutsideCandidates).toBe(0)
    expect(result.sentencesRewritten).toBe(0)
    expect(result.kept.map((judged) => judged.candidate.property)).toEqual([
      "cta.label",
      "heading.size",
    ])
    expect(result.kept[0]?.sentence).toBe(
      "This screen says Next. 4 sibling screens say Continue.",
    )
  })

  it("drops a finding whose cited value is not in the record, and counts it", () => {
    const invented: Assessment = { ...honest(1, "The heading is 18px."), citedValue: "18px" }

    const result = reconcile({ candidates, assessments: [honest(0, "Says Next."), invented], extraction })

    expect(result.dropped).toBe(1)
    expect(result.kept.map((judged) => judged.candidate.property)).toEqual(["cta.label"])
  })

  it("drops a finding whose cited value is reworded rather than quoted", () => {
    const reworded: Assessment = {
      ...honest(0, 'The button says "Next".'),
      citedValue: "next",
    }

    const result = reconcile({ candidates, assessments: [reworded], extraction })

    expect(result.dropped).toBe(1)
    expect(result.kept).toEqual([])
  })

  it("drops a finding attributed to the wrong element", () => {
    const misattributed: Assessment = {
      ...honest(1, "The button renders at 20px."),
      citedSelector: NEXT_SELECTOR,
    }

    const result = reconcile({ candidates, assessments: [misattributed], extraction })

    expect(result.dropped).toBe(1)
    expect(result.kept).toEqual([])
  })

  it("drops a proposal about a candidate that was never on the list", () => {
    const invented: Assessment = {
      candidateIndex: 7,
      material: true,
      citedSelector: NEXT_SELECTOR,
      citedProperty: "cta.radius",
      citedValue: "8px",
      sentence: "The corner radius is 8px.",
    }

    const result = reconcile({ candidates, assessments: [invented], extraction })

    expect(result.droppedOutsideCandidates).toBe(1)
    expect(result.kept).toEqual([])
  })

  it("drops a proposal that cites a real value other than the candidate's", () => {
    // 700 is really the heading's font weight, but the candidate is its size.
    const swapped: Assessment = {
      candidateIndex: 1,
      material: true,
      citedSelector: HEADING_SELECTOR,
      citedProperty: "heading.weight",
      citedValue: "700",
      sentence: "The heading is 700 weight.",
    }

    const result = reconcile({ candidates, assessments: [swapped], extraction })

    expect(result.dropped).toBe(0)
    expect(result.droppedOutsideCandidates).toBe(1)
    expect(result.kept).toEqual([])
  })

  it("drops a second opinion on a candidate already answered", () => {
    const result = reconcile({
      candidates,
      assessments: [honest(0, "Says Next."), honest(0, "Says Next again.")],
      extraction,
    })

    expect(result.droppedOutsideCandidates).toBe(1)
    expect(result.kept).toHaveLength(1)
  })

  it("writes nothing for a divergence the model calls immaterial", () => {
    const result = reconcile({
      candidates,
      assessments: [{ ...honest(0, "Says Next."), material: false }],
      extraction,
    })

    expect(result.immaterial).toBe(1)
    expect(result.dropped).toBe(0)
    expect(result.kept).toEqual([])
  })

  it("returns nothing at all when the model returned nothing at all", () => {
    const result = reconcile({ candidates, assessments: [], extraction })

    expect(result).toMatchObject({ kept: [], proposed: 0, dropped: 0 })
  })

  it("keeps a true finding but rewrites a sentence that does not quote its value", () => {
    const vague = honest(0, "Something about this button feels off.")

    const result = reconcile({ candidates, assessments: [vague], extraction })

    expect(result.kept).toHaveLength(1)
    expect(result.sentencesRewritten).toBe(1)
    expect(result.kept[0]?.sentence).toBe(
      "This screen's last action label is Next. 4 sibling screens use Continue.",
    )
  })

  it("rewrites a sentence that breaks the copy rules", () => {
    for (const sentence of [
      "This screen says Next — its siblings say Continue.",
      "This screen says Next!",
      "",
    ]) {
      const result = reconcile({ candidates, assessments: [honest(0, sentence)], extraction })

      expect(result.sentencesRewritten).toBe(1)
      expect(result.kept[0]?.sentence).toBe(plainSentence(candidates[0] as DivergenceCandidate))
    }
  })
})

describe("plainSentence", () => {
  it("reads as evidence, with the counts", () => {
    expect(plainSentence(candidates[1]!)).toBe(
      "This screen's first heading type size is 20px. 5 sibling screens use 24px.",
    )
  })

  it("stays grammatical with one sibling", () => {
    const single = { ...candidates[1]!, siblingScreenIds: ["screen1"] }

    expect(plainSentence(single)).toContain("1 sibling screen uses 24px.")
  })
})
