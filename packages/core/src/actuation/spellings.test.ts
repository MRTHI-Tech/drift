import { describe, expect, it } from "vitest"

import { colorSpellings, lengthSpellings, sourceSpellings, valueGroupOf } from "./spellings"

describe("colorSpellings", () => {
  it("crosses the gap between what Chromium reports and what a repo writes", () => {
    const spellings = colorSpellings("rgb(255, 0, 0)")

    expect(spellings).toContain("#ff0000")
    expect(spellings).toContain("#FF0000")
    expect(spellings).toContain("#f00")
    expect(spellings).toContain("rgb(255, 0, 0)")
    expect(spellings).toContain("rgb(255,0,0)")
    expect(spellings).toContain("rgb(255 0 0)")
  })

  it("offers the short hex only when every channel repeats its digit", () => {
    expect(colorSpellings("rgb(239, 68, 68)")).not.toContain("#e44")
    expect(colorSpellings("rgb(239, 68, 68)")).toContain("#ef4444")
  })

  it("keeps alpha where there is any", () => {
    const spellings = colorSpellings("rgba(255, 0, 0, 0.5)")

    expect(spellings.some((spelling) => spelling.startsWith("rgba("))).toBe(true)
    expect(spellings).not.toContain("#ff0000")
  })

  it("leaves a colour it cannot read exactly as it is", () => {
    expect(colorSpellings("var(--brand)")).toEqual(["var(--brand)"])
  })
})

describe("lengthSpellings", () => {
  it("offers px and rem for a length that lands on the root size", () => {
    expect(lengthSpellings("18px")).toEqual(["18px", "1.125rem", "1.125em"])
  })

  it("offers only px for one that does not", () => {
    expect(lengthSpellings("13px")).toEqual(["13px", "0.8125rem", "0.8125em"])
  })

  it("never offers a bare number, which would match anything", () => {
    expect(lengthSpellings("0px")).toEqual(["0px", "0rem", "0em"])
    expect(lengthSpellings("8px")).not.toContain("8")
  })

  it("reads a rem back as the px it renders at", () => {
    expect(lengthSpellings("1rem")).toContain("16px")
  })
})

describe("sourceSpellings", () => {
  it("always includes the value exactly as it was given", () => {
    expect(sourceSpellings("rgb(255, 0, 0)", "color")[0]).toBe("rgb(255, 0, 0)")
  })

  it("gives an unknown group the one spelling it was handed", () => {
    expect(sourceSpellings("Continue", null)).toEqual(["Continue"])
  })
})

describe("valueGroupOf", () => {
  it("reads both the CSS property names and the dotted convention ones", () => {
    expect(valueGroupOf("background-color")).toBe("color")
    expect(valueGroupOf("color")).toBe("color")
    expect(valueGroupOf("font-size")).toBe("fontSize")
    expect(valueGroupOf("cta.size")).toBe("fontSize")
    expect(valueGroupOf("border-radius")).toBe("radius")
    expect(valueGroupOf("cta.radius")).toBe("radius")
    expect(valueGroupOf("padding")).toBe("spacing")
    expect(valueGroupOf("heading.weight")).toBe("fontWeight")
  })

  it("has no group for a label", () => {
    expect(valueGroupOf("cta.label")).toBeNull()
  })
})
