import { gateProposedFix, type SourceFile } from "@drift/core"
import { describe, expect, it } from "vitest"

import { arrivalFor } from "./fixer"

/** One onboarding step whose heading went formal, as source writes it. */
const FILES: SourceFile[] = [
  {
    path: "app/onboarding/step-6.tsx",
    text: `export function StepSix() {
  return (
    <section>
      <h1 className="text-2xl">Personal information</h1>
      <button>Continue</button>
    </section>
  )
}
`,
  },
]

/** The gate as the Fixer would call it for a tone finding. */
function gateTone(replace: string) {
  return gateProposedFix({
    edits: [
      {
        path: "app/onboarding/step-6.tsx",
        find: '<h1 className="text-2xl">Personal information</h1>',
        replace,
      },
    ],
    files: FILES,
    kind: "copy",
    from: "formal",
    to: "warm",
    group: null,
    arrival: arrivalFor("heading.tone", "warm"),
  })
}

describe("arrivalFor", () => {
  it("checks a style property by looking for the value", () => {
    expect(arrivalFor("heading.size", "24px")).toEqual({ kind: "literal" })
  })

  it("checks a derived property by reading it again", () => {
    expect(arrivalFor("heading.tone", "warm").kind).toBe("derived")
    expect(arrivalFor("cta.voice", "specific").kind).toBe("derived")
  })

  it("knows nothing about a property Drift does not measure", () => {
    expect(arrivalFor("colour.vibes", "nice")).toEqual({ kind: "literal" })
  })
})

describe("a tone fix, through the real classifier and the real gate", () => {
  it("passes when the new heading actually reads as warm", () => {
    const result = gateTone('<h1 className="text-2xl">Let\'s get you set up</h1>')

    expect(result.kept).toBe(1)
    expect(result.plan?.author).toBe("model")
    expect(result.plan?.files[0]?.after).toContain("Let's get you set up")
  })

  it("refuses a heading that is merely different, not warmer", () => {
    const result = gateTone('<h1 className="text-2xl">Account information</h1>')

    expect(result.plan).toBeNull()
  })

  it("refuses a heading that is neutral rather than warm", () => {
    const result = gateTone('<h1 className="text-2xl">Step six</h1>')

    expect(result.plan).toBeNull()
  })
})
