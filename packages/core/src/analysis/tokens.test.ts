import { describe, expect, it } from "vitest"

import { THEME_SOURCE, TOKENS_JSON } from "./fixtures"
import {
  countTokens,
  emptyTokenSet,
  parseFontWeight,
  parseTokenDefinitions,
  TokenDefinitionsError,
  tokenSetFrom,
} from "./tokens"

describe("parseTokenDefinitions", () => {
  it("reads a theme.ts without running it", () => {
    const tokens = parseTokenDefinitions(THEME_SOURCE, "src/theme.ts")

    expect(tokens.color.map((token) => token.name)).toEqual([
      "colors.brand.500",
      "colors.brand.600",
      "colors.surface.base",
      "colors.surface.raised",
      "colors.text.muted",
      "colors.text.primary",
    ])
    expect(tokens.spacing).toHaveLength(7)
    expect(tokens.fontSize.map((token) => token.value)).toEqual([
      "1rem",
      "1.25rem",
      "0.875rem",
      "2rem",
    ])
    // By name, so bold, medium, regular.
    expect(tokens.fontWeight.map((token) => token.value)).toEqual(["700", "500", "400"])
    expect(tokens.radius).toHaveLength(3)
  })

  it("reads a tokens.json into the same values", () => {
    const fromTheme = parseTokenDefinitions(THEME_SOURCE, "theme.ts")
    const fromJson = parseTokenDefinitions(TOKENS_JSON, "design/tokens.json")

    for (const group of ["color", "spacing", "fontSize", "fontWeight", "radius"] as const) {
      expect(fromJson[group].map((token) => token.value)).toEqual(
        fromTheme[group].map((token) => token.value),
      )
    }
  })

  it("counts a value declared twice once, under its shortest name", () => {
    const tokens = tokenSetFrom({
      colors: { brand: "#4F46E5" },
      theme: { colors: { primaryButtonBackground: "#4F46E5" } },
    })

    expect(tokens.color).toEqual([{ name: "colors.brand", value: "#4F46E5", group: "color" }])
  })

  it("finds a group however deep the file nests it", () => {
    const tokens = tokenSetFrom({ theme: { extend: { spacing: { gutter: "24px" } } } })

    expect(tokens.spacing).toEqual([
      { name: "theme.extend.spacing.gutter", value: "24px", group: "spacing" },
    ])
  })

  it("takes the size out of a Tailwind type scale tuple", () => {
    const tokens = tokenSetFrom({ fontSize: { base: ["1rem", { lineHeight: "1.5rem" }] } })

    expect(tokens.fontSize).toEqual([{ name: "fontSize.base", value: "1rem", group: "fontSize" }])
  })

  it("drops values it cannot compare against anything", () => {
    const tokens = tokenSetFrom({
      colors: { brand: "var(--brand)", surface: "#fff" },
      spacing: { gutter: "auto", page: "16px" },
    })

    expect(tokens.color.map((token) => token.name)).toEqual(["colors.surface"])
    expect(tokens.spacing.map((token) => token.name)).toEqual(["spacing.page"])
  })

  it("is an empty set for a file with nothing recognisable in it", () => {
    expect(countTokens(parseTokenDefinitions("export const zIndex = { modal: 40 }", "theme.ts"))).toBe(0)
    expect(countTokens(emptyTokenSet())).toBe(0)
  })

  it("says so when a json token file is broken", () => {
    expect(() => parseTokenDefinitions("{ nope", "tokens.json")).toThrow(TokenDefinitionsError)
  })

  it("is deterministic over the same source", () => {
    expect(parseTokenDefinitions(THEME_SOURCE, "theme.ts")).toEqual(
      parseTokenDefinitions(THEME_SOURCE, "theme.ts"),
    )
  })
})

describe("parseFontWeight", () => {
  it("reads numbers and the two keywords CSS gives a number to", () => {
    expect(parseFontWeight("600")).toBe(600)
    expect(parseFontWeight(500)).toBe(500)
    expect(parseFontWeight("normal")).toBe(400)
    expect(parseFontWeight("bold")).toBe(700)
  })

  it("leaves the relative keywords alone", () => {
    expect(parseFontWeight("bolder")).toBeNull()
    expect(parseFontWeight("")).toBeNull()
  })
})
