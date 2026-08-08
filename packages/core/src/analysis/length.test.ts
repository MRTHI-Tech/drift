import { describe, expect, it } from "vitest"

import { parseLengthPx, ROOT_FONT_SIZE_PX, sameLength, splitShorthand } from "./length"

describe("parseLengthPx", () => {
  it("reads px, rem, and a bare number", () => {
    expect(parseLengthPx("13px")).toBe(13)
    expect(parseLengthPx("0.75rem")).toBe(0.75 * ROOT_FONT_SIZE_PX)
    expect(parseLengthPx("8")).toBe(8)
    expect(parseLengthPx(8)).toBe(8)
    expect(parseLengthPx("-4px")).toBe(-4)
  })

  it("leaves anything that is not a fixed length alone", () => {
    expect(parseLengthPx("auto")).toBeNull()
    expect(parseLengthPx("50%")).toBeNull()
    expect(parseLengthPx("calc(100% - 8px)")).toBeNull()
    expect(parseLengthPx("")).toBeNull()
    expect(parseLengthPx("8px 4px")).toBeNull()
  })
})

describe("sameLength", () => {
  it("ignores sub-pixel jitter and nothing more", () => {
    expect(sameLength(12, 12.005)).toBe(true)
    // A scaled type ramp reporting 13.3333px for a 13.5px token.
    expect(sameLength(13.5, 13.3333)).toBe(true)
    expect(sameLength(12, 12.6)).toBe(false)
  })
})

describe("splitShorthand", () => {
  it("splits a box shorthand into its decisions", () => {
    expect(splitShorthand("0px 8px 13px 8px")).toEqual(["0px", "8px", "13px", "8px"])
    expect(splitShorthand("16px")).toEqual(["16px"])
  })

  it("splits both sets of a border-radius", () => {
    expect(splitShorthand("8px / 16px")).toEqual(["8px", "16px"])
  })
})
