import { describe, expect, it } from "vitest"

import type { ComputedStyles, ScreenText } from "../types"
import { SCREEN_STYLES, SCREEN_TEXT } from "./fixtures"
import { buildSignature, SECTION_GAP_PX } from "./signature"

const input = {
  route: "/",
  viewport: "mobile" as const,
  computedStyles: SCREEN_STYLES,
  text: SCREEN_TEXT,
}

describe("buildSignature", () => {
  it("is deterministic for identical input", () => {
    const first = buildSignature(input)
    const second = buildSignature({
      ...input,
      computedStyles: structuredClone(SCREEN_STYLES),
      text: structuredClone(SCREEN_TEXT),
    })

    expect(second).toEqual(first)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it("carries the interactive labels with their positions, top to bottom", () => {
    expect(buildSignature(input).interactive).toEqual([
      {
        selector: "[data-testid='hero-cta']",
        tag: "button",
        label: "Get started",
        x: 16,
        y: 136,
      },
      {
        selector: "[data-testid='card'] > a:nth-of-type(1)",
        tag: "a",
        label: "Read the docs",
        x: 32,
        y: 380,
      },
    ])
  })

  it("labels a control from the text under it when it has none of its own", () => {
    const computedStyles: ComputedStyles = {
      "[data-testid='cta']": SCREEN_STYLES["[data-testid='hero-cta']"]!,
      "[data-testid='cta'] > span:nth-of-type(1)": SCREEN_STYLES["[data-testid='hero-cta']"]!,
    }
    const text: ScreenText = { "[data-testid='cta'] > span:nth-of-type(1)": "Start free trial" }

    expect(buildSignature({ ...input, computedStyles, text }).interactive[0]?.label).toBe(
      "Start free trial",
    )
  })

  it("reads the type hierarchy as size and weight pairs, top to bottom", () => {
    expect(buildSignature(input).typeHierarchy).toEqual([
      { fontSize: 32, fontWeight: 700 },
      { fontSize: 16, fontWeight: 400 },
      { fontSize: 16, fontWeight: 500 },
      { fontSize: 20, fontWeight: 700 },
      { fontSize: 14, fontWeight: 500 },
      { fontSize: 14, fontWeight: 400 },
    ])
  })

  it("leaves a container out of the hierarchy its children render", () => {
    const computedStyles: ComputedStyles = {
      "[data-testid='card']": SCREEN_STYLES["[data-testid='card']"]!,
      "[data-testid='card'] > h2:nth-of-type(1)":
        SCREEN_STYLES["[data-testid='card'] > h2:nth-of-type(1)"]!,
    }
    const text: ScreenText = { "[data-testid='card'] > h2:nth-of-type(1)": "How it works" }

    expect(buildSignature({ ...input, computedStyles, text }).typeHierarchy).toEqual([
      { fontSize: 20, fontWeight: 700 },
    ])
  })

  it("collapses a run of the same step into one", () => {
    const computedStyles: ComputedStyles = {}
    const text: ScreenText = {}
    for (let index = 0; index < 5; index += 1) {
      const selector = `body > p:nth-of-type(${index + 1})`
      computedStyles[selector] = {
        tag: "p",
        box: { x: 0, y: index * 24, width: 390, height: 20 },
        styles: SCREEN_STYLES["[data-testid='hero'] > p:nth-of-type(1)"]!.styles,
      }
      text[selector] = `Line ${index + 1}`
    }

    expect(buildSignature({ ...input, computedStyles, text }).typeHierarchy).toEqual([
      { fontSize: 16, fontWeight: 400 },
    ])
  })

  it("counts the bands of content and the gaps between them", () => {
    const signature = buildSignature(input)

    // Hero copy runs together, then the card heading, its link, the footer.
    expect(signature.sectionCount).toBe(4)
    expect(signature.verticalRhythm).toEqual([76, 96, 524])
    expect(signature.verticalRhythm.every((gap) => gap >= SECTION_GAP_PX)).toBe(true)
  })

  it("flags how the copy is written, without concluding anything from it", () => {
    expect(buildSignature(input).copy).toEqual({
      labels: {
        count: 2,
        sentence: 2,
        title: 0,
        upper: 0,
        lower: 0,
        other: 0,
        imperative: 2,
        dominantCase: "sentence",
      },
      headings: {
        count: 2,
        sentence: 2,
        title: 0,
        upper: 0,
        lower: 0,
        other: 0,
        imperative: 0,
        dominantCase: "sentence",
      },
    })
  })

  it("hashes the shape and the token values apart from each other", () => {
    const base = buildSignature(input)

    const recoloured = structuredClone(SCREEN_STYLES)
    recoloured["[data-testid='hero-cta']"]!.styles["background-color"] = "rgb(1, 2, 3)"
    const differentTokens = buildSignature({ ...input, computedStyles: recoloured })

    const moved = structuredClone(SCREEN_STYLES)
    moved["[data-testid='card']"]!.box.y = 260
    const differentShape = buildSignature({ ...input, computedStyles: moved })

    expect(differentTokens.structureHash).toBe(base.structureHash)
    expect(differentTokens.tokenHash).not.toBe(base.tokenHash)
    expect(differentShape.structureHash).not.toBe(base.structureHash)
    expect(differentShape.tokenHash).toBe(base.tokenHash)
  })

  it("signs an empty screen without falling over", () => {
    const signature = buildSignature({ ...input, computedStyles: {}, text: {} })

    expect(signature).toMatchObject({
      route: "/",
      viewport: "mobile",
      interactive: [],
      typeHierarchy: [],
      sectionCount: 0,
      verticalRhythm: [],
    })
    expect(signature.copy.labels.dominantCase).toBeNull()
  })
})
