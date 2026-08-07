import { describe, expect, it } from "vitest"

import type { SourceFile } from "../github"
import {
  NEAREST_TOKEN,
  PATTERN_FINDING,
  PLANTED_HEX,
  SOURCE_FILES,
  TOKEN_FINDING,
} from "./fixtures"
import { patchKindOf, planFindingPatch, planPatch } from "./patch"

const only = (files: SourceFile[], path: string): SourceFile[] =>
  files.filter((file) => file.path === path)

describe("patchKindOf", () => {
  it("reads a token finding as a value and a label finding as copy", () => {
    expect(patchKindOf(TOKEN_FINDING)).toBe("value")
    expect(patchKindOf(PATTERN_FINDING)).toBe("copy")
  })

  it("reads a pattern finding on a style property as a value", () => {
    const sized = {
      ...PATTERN_FINDING,
      evidence: { ...PATTERN_FINDING.evidence, property: "cta.size" },
    }

    expect(patchKindOf(sized)).toBe("value")
  })
})

describe("planFindingPatch, a value substitution", () => {
  it("finds the hardcoded colour through its hex spelling", () => {
    const plan = planFindingPatch(TOKEN_FINDING, "conform", SOURCE_FILES)

    expect(plan.blocked).toBeNull()
    expect(plan.occurrences).toBe(1)
    expect(plan.files).toHaveLength(1)
    expect(plan.files[0]?.path).toBe("app/pricing/page.tsx")
    expect(plan.files[0]?.after).toContain(`backgroundColor: "${NEAREST_TOKEN.value}"`)
  })

  it("leaves a longer hex that only starts the same way alone", () => {
    const plan = planFindingPatch(TOKEN_FINDING, "conform", SOURCE_FILES)

    expect(plan.files[0]?.after).toContain("#ff000011")
  })

  it("changes nothing else in the file", () => {
    const plan = planFindingPatch(TOKEN_FINDING, "conform", SOURCE_FILES)
    const before = SOURCE_FILES[0]!.text

    expect(plan.files[0]?.after).toBe(before.replace(PLANTED_HEX, NEAREST_TOKEN.value))
  })

  it("blocks when the value is written nowhere in source", () => {
    const plan = planFindingPatch(TOKEN_FINDING, "conform", only(SOURCE_FILES, "theme.ts"))

    expect(plan.occurrences).toBe(0)
    expect(plan.blocked).toMatch(/No source file writes/)
  })

  it("blocks when the two values are the same thing written two ways", () => {
    const plan = planPatch({
      kind: "value",
      from: "rgb(255, 0, 0)",
      to: "#FF0000",
      group: "color",
      files: SOURCE_FILES,
    })

    expect(plan.blocked).toMatch(/same value written two ways/)
  })

  it("blocks rather than replacing a value that is everywhere", () => {
    const files: SourceFile[] = [
      { path: "a.css", text: Array.from({ length: 30 }, () => "color: #ff0000;").join("\n") },
    ]

    const plan = planPatch({
      kind: "value",
      from: "rgb(255, 0, 0)",
      to: "#EF4444",
      group: "color",
      files,
    })

    expect(plan.blocked).toMatch(/over the limit/)
    expect(plan.files).toEqual([])
  })

  it("does not match a length inside a longer or a negative one", () => {
    const files: SourceFile[] = [
      { path: "a.css", text: ".a { padding: 13px; margin: -13px; width: 113px; }" },
    ]

    const plan = planPatch({ kind: "value", from: "13px", to: "12px", group: "spacing", files })

    expect(plan.occurrences).toBe(1)
    expect(plan.files[0]?.after).toBe(".a { padding: 12px; margin: -13px; width: 113px; }")
  })
})

describe("planFindingPatch, a copy substitution", () => {
  it("changes the label where it is the whole of an element's text", () => {
    const plan = planFindingPatch(PATTERN_FINDING, "conform", SOURCE_FILES)

    expect(plan.kind).toBe("copy")
    expect(plan.occurrences).toBe(1)
    expect(plan.files[0]?.after).toContain(">Continue</button>")
  })

  it("leaves Next.js in a comment alone", () => {
    const plan = planFindingPatch(PATTERN_FINDING, "conform", SOURCE_FILES)

    expect(plan.files[0]?.after).toContain("Built with Next.js")
  })

  it("changes a label written as a string literal, keeping its quotes", () => {
    const files: SourceFile[] = [
      { path: "a.tsx", text: `const label = 'Next'\nconst other = "Nextdoor"\n` },
    ]

    const plan = planPatch({ kind: "copy", from: "Next", to: "Continue", group: null, files })

    expect(plan.occurrences).toBe(1)
    expect(plan.files[0]?.after).toBe(`const label = 'Continue'\nconst other = "Nextdoor"\n`)
  })

  it("runs the other way for an update-siblings resolution", () => {
    const plan = planFindingPatch(PATTERN_FINDING, "siblings", SOURCE_FILES)

    expect(plan.from).toBe("Continue")
    expect(plan.to).toBe("Next")
    expect(plan.files[0]?.path).toBe("app/checkout/step-2.tsx")
    expect(plan.files[0]?.after).toContain(">Next</button>")
  })
})
