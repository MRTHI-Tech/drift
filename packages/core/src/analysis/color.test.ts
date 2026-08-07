import { describe, expect, it } from "vitest"

import { canonicalColor, colorDistance, isFullyTransparent, parseColor, sameColor } from "./color"

function canonical(value: string): string | null {
  const color = parseColor(value)
  return color ? canonicalColor(color) : null
}

describe("parseColor", () => {
  it("reads the spellings a token file uses", () => {
    expect(canonical("#4F46E5")).toBe("rgb(79, 70, 229)")
    expect(canonical("#fff")).toBe("rgb(255, 255, 255)")
    expect(canonical("white")).toBe("rgb(255, 255, 255)")
    expect(canonical("hsl(220, 90%, 56%)")).toBe("rgb(42, 109, 244)")
  })

  it("reads the spellings Chromium reports", () => {
    expect(canonical("rgb(79, 70, 229)")).toBe("rgb(79, 70, 229)")
    expect(canonical("rgba(79, 70, 229, 0.5)")).toBe("rgba(79, 70, 229, 0.5)")
    expect(canonical("rgb(79 70 229 / 50%)")).toBe("rgba(79, 70, 229, 0.5)")
    expect(canonical("color(srgb 1 1 1)")).toBe("rgb(255, 255, 255)")
  })

  it("reads the oklch a shadcn theme is written in", () => {
    // The preset writes its variables in oklch; Chromium reports the same
    // colour back as sRGB, and the two have to meet.
    expect(canonical("oklch(1 0 0)")).toBe("rgb(255, 255, 255)")
    expect(canonical("oklch(0 0 0)")).toBe("rgb(0, 0, 0)")
    expect(canonical("oklab(0.5 0 0)")).toBe(canonical("oklch(0.5 0 0)"))
  })

  it("matches a hex against the rgb Chromium reports for it", () => {
    expect(sameColor(parseColor("#4F46E5")!, parseColor("rgb(79, 70, 229)")!)).toBe(true)
    expect(sameColor(parseColor("#4F46E5")!, parseColor("#7C3AED")!)).toBe(false)
  })

  it("leaves anything it cannot read alone", () => {
    expect(parseColor("var(--brand)")).toBeNull()
    expect(parseColor("currentColor")).toBeNull()
    expect(parseColor("linear-gradient(#fff, #000)")).toBeNull()
    expect(parseColor("")).toBeNull()
    expect(parseColor("#12345")).toBeNull()
  })

  it("keeps alpha, and knows when nothing is showing", () => {
    expect(isFullyTransparent(parseColor("rgba(0, 0, 0, 0)")!)).toBe(true)
    expect(isFullyTransparent(parseColor("transparent")!)).toBe(true)
    expect(isFullyTransparent(parseColor("#00000080")!)).toBe(false)
  })
})

describe("colorDistance", () => {
  it("is zero for the same colour written two ways", () => {
    expect(colorDistance(parseColor("#4F46E5")!, parseColor("rgb(79, 70, 229)")!)).toBe(0)
  })

  it("puts a near miss nearer than a different colour", () => {
    const brand = parseColor("#4F46E5")!
    const nearMiss = colorDistance(brand, parseColor("#4F46E0")!)
    const different = colorDistance(brand, parseColor("#F97316")!)

    expect(nearMiss).toBeLessThan(different)
    expect(nearMiss).toBeLessThan(0.02)
  })

  it("does not call an opaque colour the same as a transparent one", () => {
    expect(colorDistance(parseColor("#000000")!, parseColor("rgba(0, 0, 0, 0)")!)).toBeGreaterThan(0)
  })

  it("is symmetric", () => {
    const left = parseColor("#4F46E5")!
    const right = parseColor("#7C3AED")!

    expect(colorDistance(left, right)).toBe(colorDistance(right, left))
  })
})
