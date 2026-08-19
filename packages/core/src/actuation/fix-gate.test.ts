import { describe, expect, it } from "vitest"

import { MAX_FIX_FILES, MAX_FIX_LINES } from "./constants"
import { gateProposedFix, type FixGateInput, type ProposedEdit } from "./fix-gate"
import { NEAREST_TOKEN, PLANTED_HEX, SOURCE_FILES } from "./fixtures"

/** The one edit that qualifies, which every other case here is a change to. */
const QUALIFYING: ProposedEdit = {
  path: "app/pricing/page.tsx",
  find: `backgroundColor: "${PLANTED_HEX}"`,
  replace: `backgroundColor: "${NEAREST_TOKEN.value}"`,
}

function gate(edits: readonly ProposedEdit[], overrides: Partial<FixGateInput> = {}) {
  return gateProposedFix({
    edits,
    files: SOURCE_FILES,
    kind: "value",
    from: PLANTED_HEX,
    to: NEAREST_TOKEN.value,
    group: "color",
    ...overrides,
  })
}

describe("gateProposedFix", () => {
  it("keeps an edit that is applicable and arrives at the value", () => {
    const result = gate([QUALIFYING])

    expect(result.kept).toBe(1)
    expect(result.plan?.files).toHaveLength(1)
    expect(result.plan?.files[0]?.path).toBe("app/pricing/page.tsx")
    expect(result.plan?.files[0]?.after).toContain(NEAREST_TOKEN.value)
    expect(result.reasons).toEqual([])
  })

  it("marks what it returns as the model's, never as mechanical", () => {
    expect(gate([QUALIFYING]).plan?.author).toBe("model")
  })

  it("leaves every other file exactly as it was", () => {
    const result = gate([QUALIFYING])

    expect(result.plan?.files.map((file) => file.path)).toEqual(["app/pricing/page.tsx"])
  })

  it("refuses a file the Fixer was never given", () => {
    const result = gate([{ ...QUALIFYING, path: "app/secrets/keys.ts" }])

    expect(result.plan).toBeNull()
    expect(result.dropped["unknown-file"]).toBe(1)
  })

  it("refuses a path that is not source", () => {
    const result = gate([{ ...QUALIFYING, path: "pnpm-lock.yaml" }], {
      files: [...SOURCE_FILES, { path: "pnpm-lock.yaml", text: PLANTED_HEX }],
    })

    expect(result.plan).toBeNull()
    expect(result.dropped["not-source"]).toBe(1)
  })

  it("refuses text that is not in the file", () => {
    const result = gate([{ ...QUALIFYING, find: 'backgroundColor: "#123456"' }])

    expect(result.plan).toBeNull()
    expect(result.dropped.absent).toBe(1)
  })

  it("refuses text the file holds more than once", () => {
    // `<main` appears once, but a bare quote appears throughout.
    const result = gate([{ ...QUALIFYING, find: '"' }])

    expect(result.plan).toBeNull()
    expect(result.dropped.ambiguous).toBe(1)
  })

  it("refuses an edit that deletes its match", () => {
    const result = gate([{ ...QUALIFYING, replace: "" }])

    expect(result.plan).toBeNull()
    expect(result.dropped.empty).toBe(1)
  })

  it("refuses an edit that changes nothing", () => {
    const result = gate([{ ...QUALIFYING, replace: QUALIFYING.find }])

    expect(result.plan).toBeNull()
    expect(result.dropped["no-change"]).toBe(1)
  })

  it("refuses an edit set that never writes the value the finding asked for", () => {
    // Applicable, bounded, and about something else entirely.
    const result = gate([
      {
        path: "app/pricing/page.tsx",
        find: '<h1 className="text-2xl">Pricing</h1>',
        replace: '<h1 className="text-3xl">Pricing</h1>',
      },
    ])

    expect(result.plan).toBeNull()
    expect(result.kept).toBe(0)
    expect(result.reasons.at(-1)).toContain(NEAREST_TOKEN.value)
  })

  it("applies two edits to one file in order, re-reading it between them", () => {
    const result = gate([
      QUALIFYING,
      {
        path: "app/pricing/page.tsx",
        find: 'padding: "13px"',
        replace: 'padding: "12px"',
      },
    ])

    expect(result.kept).toBe(2)
    expect(result.plan?.files).toHaveLength(1)
    expect(result.plan?.files[0]?.after).toContain(NEAREST_TOKEN.value)
    expect(result.plan?.files[0]?.after).toContain('padding: "12px"')
  })

  it("stops at the line bound rather than trimming the fix to fit", () => {
    const long = Array.from({ length: MAX_FIX_LINES + 1 }, (_u, i) => `// line ${i}`).join("\n")
    const result = gate([QUALIFYING, { ...QUALIFYING, find: "<main", replace: long }])

    expect(result.kept).toBe(1)
    expect(result.dropped["too-large"]).toBe(1)
  })

  it("stops at the file bound", () => {
    const files = Array.from({ length: MAX_FIX_FILES + 1 }, (_u, i) => ({
      path: `app/page-${i}.tsx`,
      text: `export const shade = "${PLANTED_HEX}"\n`,
    }))
    const edits = files.map((file) => ({
      path: file.path,
      find: `"${PLANTED_HEX}"`,
      replace: `"${NEAREST_TOKEN.value}"`,
    }))

    const result = gate(edits, { files })

    expect(result.kept).toBe(MAX_FIX_FILES)
    expect(result.dropped["too-large"]).toBe(1)
    expect(result.plan?.files).toHaveLength(MAX_FIX_FILES)
  })

  it("counts every drop and says why, without throwing", () => {
    const result = gate([
      { path: "nowhere.tsx", find: "a", replace: "b" },
      { ...QUALIFYING, find: "not in the file" },
      QUALIFYING,
    ])

    expect(result.proposed).toBe(3)
    expect(result.kept).toBe(1)
    expect(result.reasons).toHaveLength(2)
    expect(result.plan).not.toBeNull()
  })

  it("checks a derived property by reading what was written, not by matching it", () => {
    // `heading.tone` asks for "warm", and no source file will ever contain
    // that word. What arrives is a heading that reads as warm.
    const files = [{ path: "app/step/page.tsx", text: "<h1>Personal information</h1>\n" }]
    const result = gate(
      [
        {
          path: "app/step/page.tsx",
          find: "<h1>Personal information</h1>",
          replace: "<h1>Let's get you set up</h1>",
        },
      ],
      {
        files,
        kind: "copy",
        from: "formal",
        to: "warm",
        group: null,
        arrival: { kind: "derived", reads: (text) => text.includes("Let's") },
      },
    )

    expect(result.kept).toBe(1)
    expect(result.plan?.files[0]?.after).toContain("Let's get you set up")
  })

  it("refuses a derived fix that does not read as what was asked for", () => {
    const files = [{ path: "app/step/page.tsx", text: "<h1>Personal information</h1>\n" }]
    const result = gate(
      [
        {
          path: "app/step/page.tsx",
          find: "<h1>Personal information</h1>",
          replace: "<h1>Account information</h1>",
        },
      ],
      {
        files,
        kind: "copy",
        from: "formal",
        to: "warm",
        group: null,
        arrival: { kind: "derived", reads: (text) => text.includes("Let's") },
      },
    )

    expect(result.plan).toBeNull()
  })

  it("reads a derived value off the words, not off the markup around them", () => {
    const files = [{ path: "app/step/page.tsx", text: '<h1 className="terms-list">Hi</h1>\n' }]
    let seen = ""
    gate(
      [
        {
          path: "app/step/page.tsx",
          find: '<h1 className="terms-list">Hi</h1>',
          replace: '<h1 className="terms-list">Hey, how are you?</h1>',
        },
      ],
      {
        files,
        kind: "copy",
        from: "formal",
        to: "warm",
        group: null,
        arrival: {
          kind: "derived",
          reads: (text) => {
            seen = text
            return true
          },
        },
      },
    )

    expect(seen).toBe("Hey, how are you?")
  })

  it("has nothing to keep when the model proposed nothing", () => {
    const result = gate([])

    expect(result.plan).toBeNull()
    expect(result.proposed).toBe(0)
  })
})
