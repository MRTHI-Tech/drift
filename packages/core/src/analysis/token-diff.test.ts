import { describe, expect, it } from "vitest"

import { dedupeKey } from "../dedupe"
import type { ComputedStyles, StyleValues } from "../types"
import {
  PLANTED_COLOR,
  PLANTED_PADDING,
  SCREEN_STYLES,
  styleValues,
  THEME_SOURCE,
  TOKENS_JSON,
} from "./fixtures"
import { diffScreenTokens, UNDIFFED_PROPERTIES, valueAppearsIn } from "./token-diff"
import { emptyTokenSet, parseTokenDefinitions } from "./tokens"

const tokens = parseTokenDefinitions(THEME_SOURCE, "theme.ts")

describe("diffScreenTokens", () => {
  it("finds exactly the two planted violations", () => {
    const candidates = diffScreenTokens(SCREEN_STYLES, tokens)

    expect(candidates).toHaveLength(2)
    expect(candidates.map((candidate) => [candidate.property, candidate.observedValue])).toEqual([
      ["background-color", PLANTED_COLOR],
      ["padding", PLANTED_PADDING],
    ])
  })

  it("cites the element each value was seen on", () => {
    const [color, padding] = diffScreenTokens(SCREEN_STYLES, tokens)

    expect(color).toMatchObject({
      selector: "[data-testid='hero-cta']",
      group: "color",
      declaredValue: PLANTED_COLOR,
      severity: 3,
    })
    expect(padding).toMatchObject({
      selector: "[data-testid='card']",
      group: "spacing",
      declaredValue: PLANTED_PADDING,
      severity: 1,
    })
  })

  it("names the token each value sits nearest to", () => {
    const [color, padding] = diffScreenTokens(SCREEN_STYLES, tokens)

    expect(color?.nearestToken).toMatchObject({ name: "colors.brand.500", value: "#4F46E5" })
    expect(padding?.nearestToken).toMatchObject({ name: "spacing.3", value: "0.75rem" })
    expect(padding?.nearestToken?.distance).toBeCloseTo(1, 6)
  })

  it("reads a tokens.json the same way it reads a theme.ts", () => {
    const fromJson = diffScreenTokens(SCREEN_STYLES, parseTokenDefinitions(TOKENS_JSON, "tokens.json"))

    expect(fromJson).toEqual(diffScreenTokens(SCREEN_STYLES, tokens))
  })

  it("is stable across repeated runs over the same record", () => {
    const first = diffScreenTokens(SCREEN_STYLES, tokens)
    const second = diffScreenTokens(structuredClone(SCREEN_STYLES), tokens)

    expect(second).toEqual(first)
    expect(keysOf(second)).toEqual(keysOf(first))
  })

  it("raises one candidate for a colour inherited by many elements", () => {
    const inherited: ComputedStyles = {}
    for (const [selector, element] of Object.entries(SCREEN_STYLES)) {
      inherited[selector] = { ...element, styles: { ...element.styles, color: PLANTED_COLOR } }
    }

    const colors = diffScreenTokens(inherited, tokens).filter(
      (candidate) => candidate.property === "color",
    )

    expect(colors).toHaveLength(1)
    // The first element in document order, which is also the topmost.
    expect(colors[0]?.selector).toBe("body")
  })

  it("claims nothing when the repo declares no tokens", () => {
    expect(diffScreenTokens(SCREEN_STYLES, emptyTokenSet())).toEqual([])
  })

  it("leaves values it cannot read alone", () => {
    const unreadable: ComputedStyles = {
      body: {
        tag: "body",
        box: { x: 0, y: 0, width: 390, height: 100 },
        styles: {
          ...SCREEN_STYLES["body"]!.styles,
          padding: "auto",
          margin: "calc(100% - 12px)",
          "border-radius": "50%",
        },
      },
    }

    expect(diffScreenTokens(unreadable, tokens)).toEqual([])
  })

  it("does not diff the properties that need a judgment", () => {
    expect([...UNDIFFED_PROPERTIES]).toEqual([
      "line-height",
      "box-shadow",
      "display",
      "gap",
      "max-width",
      "border-width",
      "border-style",
    ])
  })
})

describe("dedupe keys over the planted violations", () => {
  it("is the same key every run, and one key per violation", () => {
    const first = keysOf(diffScreenTokens(SCREEN_STYLES, tokens))
    const second = keysOf(diffScreenTokens(structuredClone(SCREEN_STYLES), tokens))

    expect(second).toEqual(first)
    expect(new Set(first).size).toBe(2)
  })

  it("does not move when the element the value sits on moves", () => {
    const moved: ComputedStyles = { ...SCREEN_STYLES }
    const cta = moved["[data-testid='hero-cta']"]!
    delete moved["[data-testid='hero-cta']"]
    moved["[data-testid='hero'] > button:nth-of-type(1)"] = cta

    const before = keysOf(diffScreenTokens(SCREEN_STYLES, tokens))
    const after = keysOf(diffScreenTokens(moved, tokens))

    expect(new Set(after)).toEqual(new Set(before))
  })
})

describe("valueAppearsIn", () => {
  it("accepts a value the record really carries", () => {
    expect(
      valueAppearsIn(SCREEN_STYLES, "[data-testid='hero-cta']", "background-color", PLANTED_COLOR),
    ).toBe(true)
  })

  it("accepts one part of a shorthand", () => {
    expect(valueAppearsIn(SCREEN_STYLES, "[data-testid='hero']", "padding", "16px")).toBe(true)
  })

  it("rejects a value the record does not carry", () => {
    expect(
      valueAppearsIn(SCREEN_STYLES, "[data-testid='hero-cta']", "background-color", "#FF0000"),
    ).toBe(false)
    expect(valueAppearsIn(SCREEN_STYLES, "nothing-here", "color", "rgb(15, 23, 42)")).toBe(false)
    expect(valueAppearsIn(SCREEN_STYLES, "body", "font-family", "Inter")).toBe(false)
  })
})

/**
 * A screen of two elements, a root and one child under it, so a property that
 * inherits can be seen arriving from above.
 */
function nested(
  root: Partial<StyleValues>,
  child: Partial<StyleValues> = {}
): ComputedStyles {
  const box = { x: 0, y: 0, width: 390, height: 100 }
  return {
    "[data-testid='root']": {
      tag: "div",
      box,
      styles: styleValues(root),
    },
    "[data-testid='root'] > p:nth-of-type(1)": {
      tag: "p",
      box,
      styles: styleValues({ ...root, ...child }),
    },
  }
}

describe("inherited properties", () => {
  it("answers for a value once, where it was set", () => {
    const candidates = diffScreenTokens(nested({ color: PLANTED_COLOR }), tokens)

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      selector: "[data-testid='root']",
      property: "color",
      observedValue: PLANTED_COLOR,
    })
  })

  it("still answers for a child that moved the value itself", () => {
    const candidates = diffScreenTokens(
      nested({}, { color: PLANTED_COLOR }),
      tokens
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      selector: "[data-testid='root'] > p:nth-of-type(1)",
      property: "color",
    })
  })

  it("leaves the value the browser filled in alone", () => {
    // Nothing above the root to have differed from, and black is what colour
    // is before anybody sets it.
    const candidates = diffScreenTokens(nested({ color: "rgb(0, 0, 0)" }), tokens)

    expect(candidates).toHaveLength(0)
  })
})

describe("values no scale answers", () => {
  it("says nothing about a negative length", () => {
    // The spacing scale runs 0 to 32px, so it has no answer to an overlap.
    expect(diffScreenTokens(nested({ margin: "-20px" }), tokens)).toHaveLength(0)
    expect(diffScreenTokens(nested({ margin: "13px" }), tokens)).toHaveLength(1)
  })

  it("names no token for a value too far from every one of them", () => {
    // The radius scale tops out at 16px, so 40px has a nearest and it means
    // nothing: snapping it would be a redesign.
    const [far] = diffScreenTokens(nested({ "border-radius": "40px" }), tokens)
    expect(far).toMatchObject({ property: "border-radius", nearestToken: null })

    const [near] = diffScreenTokens(nested({ "border-radius": "18px" }), tokens)
    expect(near?.nearestToken).toMatchObject({ name: "radius.lg", value: "16px" })
  })
})

function keysOf(candidates: ReturnType<typeof diffScreenTokens>): string[] {
  return candidates.map((candidate) =>
    dedupeKey({
      projectId: "proj1",
      route: "/",
      property: candidate.property,
      observedValue: candidate.observedValue,
    }),
  )
}
