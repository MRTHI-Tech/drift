import { STYLE_PROPERTIES } from "@drift/core"
import { describe, expect, it } from "vitest"

import { buildExtraction, capExtraction, type RawElement } from "./extract"

function raw(overrides: Partial<RawElement> = {}): RawElement {
  return {
    tag: "button",
    selector: "body > button:nth-of-type(1)",
    box: { x: 12, y: 24, width: 100, height: 40 },
    styles: {
      color: "rgb(255, 255, 255)",
      "background-color": "rgb(17, 17, 17)",
      "font-size": "14px",
      "font-weight": "500",
      "line-height": "20px",
      margin: "0px",
      padding: "8px 16px",
      "border-radius": "6px",
      "box-shadow": "none",
      display: "inline-flex",
      gap: "8px",
      "max-width": "none",
    },
    text: "Continue",
    ...overrides,
  }
}

describe("buildExtraction", () => {
  it("keys elements by selector and keeps tag, box, and styles", () => {
    const extraction = buildExtraction([raw()])

    expect(extraction.computedStyles).toEqual({
      "body > button:nth-of-type(1)": {
        tag: "button",
        box: { x: 12, y: 24, width: 100, height: 40 },
        styles: raw().styles,
      },
    })
    expect(extraction.text).toEqual({ "body > button:nth-of-type(1)": "Continue" })
    expect(extraction.elementCount).toBe(1)
  })

  it("stores exactly the locked property list, in order", () => {
    const extraction = buildExtraction([
      raw({ styles: { ...raw().styles, "z-index": "40", "font-size": "18px" } }),
    ])

    const styles = extraction.computedStyles["body > button:nth-of-type(1)"]?.styles
    expect(Object.keys(styles ?? {})).toEqual([...STYLE_PROPERTIES])
    expect(styles?.["font-size"]).toBe("18px")
  })

  it("fills a property the page did not report with an empty string", () => {
    const { "box-shadow": _dropped, ...partial } = raw().styles
    const extraction = buildExtraction([raw({ styles: partial })])

    expect(extraction.computedStyles["body > button:nth-of-type(1)"]?.styles["box-shadow"]).toBe("")
  })

  it("rounds boxes to one decimal so sub-pixel jitter is not drift", () => {
    const extraction = buildExtraction([
      raw({ box: { x: 12.049, y: -0.02, width: 100.06, height: Number.NaN } }),
    ])

    expect(extraction.computedStyles["body > button:nth-of-type(1)"]?.box).toEqual({
      x: 12,
      y: 0,
      width: 100.1,
      height: 0,
    })
  })

  it("keeps the first element when a selector repeats", () => {
    const extraction = buildExtraction([raw({ text: "first" }), raw({ text: "second" })])

    expect(extraction.elementCount).toBe(1)
    expect(extraction.text["body > button:nth-of-type(1)"]).toBe("first")
  })

  it("collapses whitespace and omits elements with no text of their own", () => {
    const extraction = buildExtraction([
      raw({ selector: "a", text: "  Read\n  the docs " }),
      raw({ selector: "b", text: "   " }),
    ])

    expect(extraction.text).toEqual({ a: "Read the docs" })
    expect(Object.keys(extraction.computedStyles)).toEqual(["a", "b"])
  })

  it("drops an element the page could not build a selector for", () => {
    expect(buildExtraction([raw({ selector: "" })]).elementCount).toBe(0)
  })

  it("stops at the cap and says so", () => {
    const elements = [raw({ selector: "a" }), raw({ selector: "b" }), raw({ selector: "c" })]

    const extraction = buildExtraction(elements, 2)

    expect(Object.keys(extraction.computedStyles)).toEqual(["a", "b"])
    expect(extraction.truncated).toBe(true)
    expect(buildExtraction(elements, 10).truncated).toBe(false)
  })
})

describe("capExtraction", () => {
  const elements = [raw({ selector: "a" }), raw({ selector: "b" }), raw({ selector: "c" })]

  it("returns the extraction untouched when it fits", () => {
    const extraction = buildExtraction(elements)

    expect(capExtraction(extraction, 100_000)).toBe(extraction)
  })

  it("drops the tail until it fits and marks the screen truncated", () => {
    const extraction = buildExtraction(elements)
    const budget = 500

    const capped = capExtraction(extraction, budget)

    expect(capped.elementCount).toBeGreaterThan(0)
    expect(capped.elementCount).toBeLessThan(3)
    expect(Object.keys(capped.computedStyles)[0]).toBe("a")
    expect(capped.truncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(capped.computedStyles))).toBeLessThanOrEqual(budget)
  })

  it("drops an element's text with the element", () => {
    const capped = capExtraction(buildExtraction(elements), 500)

    for (const selector of Object.keys(capped.text)) {
      expect(capped.computedStyles[selector]).toBeDefined()
    }
  })
})
