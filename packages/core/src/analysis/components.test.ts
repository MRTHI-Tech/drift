import { describe, expect, it } from "vitest"

import type { ElementStyles } from "../types"
import {
  COMPONENT_ASPECT,
  COMPONENT_KINDS,
  COMPONENT_KIND_LABEL,
  COMPONENT_KIND_SINGULAR,
  COMPONENT_PROPERTIES,
  componentConventionLabel,
  componentDivergences,
  componentKind,
  componentProperty,
  deriveComponentConventions,
  isComponentProperty,
  parseComponentProperty,
  screenComponents,
} from "./components"

function element(overrides: Partial<ElementStyles> = {}): ElementStyles {
  return {
    tag: "div",
    box: { x: 0, y: 0, width: 40, height: 40 },
    styles: {
      color: "rgb(0, 0, 0)",
      "background-color": "rgb(255, 255, 255)",
      "font-size": "16px",
      "font-weight": "400",
      "line-height": "24px",
      margin: "0px",
      padding: "0px",
      "border-radius": "999px",
      "box-shadow": "none",
      display: "block",
      gap: "normal",
      "max-width": "none",
      "border-width": "1px",
      "border-style": "solid",
    },
    ...overrides,
  }
}

describe("componentKind", () => {
  it("reads a plain control off its tag", () => {
    expect(componentKind(element({ tag: "button" }))).toBe("button")
    expect(componentKind(element({ tag: "select" }))).toBe("select")
    expect(componentKind(element({ tag: "textarea" }))).toBe("textInput")
    expect(componentKind(element({ tag: "svg" }))).toBe("icon")
  })

  it("tells one input from another by its type", () => {
    const input = (type: string) => componentKind(element({ tag: "input", attributes: { type } }))

    expect(input("text")).toBe("textInput")
    expect(input("email")).toBe("textInput")
    expect(input("radio")).toBe("radio")
    expect(input("checkbox")).toBe("checkbox")
    expect(input("date")).toBe("datePicker")
  })

  it("treats an input with no type as text, which is what a browser does", () => {
    expect(componentKind(element({ tag: "input" }))).toBe("textInput")
  })

  it("believes an element that says what it is over its tag", () => {
    // Every component library builds a radio out of a div and a tab out of a
    // button. The role is the author saying so.
    expect(componentKind(element({ tag: "div", attributes: { role: "radio" } }))).toBe("radio")
    expect(componentKind(element({ tag: "button", attributes: { role: "tab" } }))).toBe("tab")
    expect(componentKind(element({ tag: "div", attributes: { role: "switch" } }))).toBe("toggle")
  })

  it("is not a component when it is not one", () => {
    expect(componentKind(element({ tag: "div" }))).toBeNull()
    expect(componentKind(element({ tag: "p" }))).toBeNull()
    expect(componentKind(element({ tag: "input", attributes: { type: "hidden" } }))).toBeNull()
  })

  it("gives every kind a label and a property list", () => {
    for (const kind of COMPONENT_KINDS) {
      expect(COMPONENT_KIND_LABEL[kind]).toBeTruthy()
      expect(COMPONENT_KIND_SINGULAR[kind]).toBeTruthy()
      expect(COMPONENT_PROPERTIES[kind].length).toBeGreaterThan(0)
    }
  })

  it("names every property any kind is judged on", () => {
    // Without this, a property added to a kind reaches a person as a CSS
    // keyword in the one sentence that exists to be read.
    const unnamed = COMPONENT_KINDS.flatMap((kind) =>
      COMPONENT_PROPERTIES[kind].filter((property) => !COMPONENT_ASPECT[property]),
    )

    expect(unnamed).toEqual([])
  })

  it("asks of a radio only what makes a radio look like one", () => {
    // Not margin, not font size. A circle and a square differ by radius.
    expect(COMPONENT_PROPERTIES.radio).toContain("border-radius")
    expect(COMPONENT_PROPERTIES.radio).not.toContain("margin")
  })

  it("asks of an input where its border is, which is the whole question", () => {
    expect(COMPONENT_PROPERTIES.textInput).toContain("border-width")
    expect(COMPONENT_PROPERTIES.textInput).toContain("border-style")
  })
})

describe("screenComponents", () => {
  it("finds every component and leaves everything else alone", () => {
    const found = screenComponents("screen1", {
      "body > div:nth-of-type(1)": element({ tag: "div" }),
      "body > button:nth-of-type(1)": element({ tag: "button" }),
      "body > svg:nth-of-type(1)": element({ tag: "svg" }),
      "body > input:nth-of-type(1)": element({ tag: "input", attributes: { type: "radio" } }),
    })

    // Selector order, with the div passed over because it is not a component.
    expect(found.map((entry) => entry.kind)).toEqual(["button", "radio", "icon"])
    expect(found.every((entry) => entry.screenId === "screen1")).toBe(true)
  })

  it("records only the properties its kind is judged on", () => {
    const [icon] = screenComponents("screen1", { "body > svg:nth-of-type(1)": element({ tag: "svg" }) })

    expect(Object.keys(icon!.values)).toEqual(["color"])
  })

  it("yields the same list in the same order for the same screen", () => {
    const styles = {
      "body > button:nth-of-type(2)": element({ tag: "button" }),
      "body > button:nth-of-type(1)": element({ tag: "button" }),
    }

    expect(screenComponents("s", styles).map((entry) => entry.selector)).toEqual([
      "body > button:nth-of-type(1)",
      "body > button:nth-of-type(2)",
    ])
  })

  it("has nothing to say about a screen with no components", () => {
    expect(screenComponents("s", { "body > p:nth-of-type(1)": element({ tag: "p" }) })).toEqual([])
  })
})

/** One instance of a kind, holding one property. */
function instance(kind: any, screenId: string, selector: string, values: Record<string, string>) {
  return { kind, screenId, selector, values }
}

describe("deriveComponentConventions", () => {
  const radios = (radius: string, n: number, screen = "s1") =>
    Array.from({ length: n }, (_u, i) =>
      instance("radio", screen, `#r${screen}${i}`, { "border-radius": radius }),
    )

  it("states what a kind agrees on across every screen it appears on", () => {
    const found = deriveComponentConventions([
      ...radios("999px", 2, "s1"),
      ...radios("999px", 2, "s2"),
    ])

    const radius = found.find((entry) => entry.property === "border-radius")
    expect(radius).toMatchObject({ kind: "radio", value: "999px", agreeing: 4, considered: 4 })
    expect(radius?.evidenceScreenIds).toEqual(["s1", "s2"])
  })

  it("needs three agreeing instances before it says anything", () => {
    expect(deriveComponentConventions(radios("999px", 2))).toEqual([])
    expect(deriveComponentConventions(radios("999px", 3))).toHaveLength(1)
  })

  it("says nothing when two values tie for first", () => {
    const found = deriveComponentConventions([
      ...radios("999px", 3, "s1"),
      ...radios("4px", 3, "s2"),
    ])

    expect(found).toEqual([])
  })

  it("never compares one kind against another", () => {
    const found = deriveComponentConventions([
      ...radios("999px", 3),
      instance("checkbox", "s1", "#c1", { "border-radius": "4px" }),
      instance("checkbox", "s1", "#c2", { "border-radius": "4px" }),
      instance("checkbox", "s1", "#c3", { "border-radius": "4px" }),
    ])

    expect(found.filter((entry) => entry.kind === "radio")[0]?.value).toBe("999px")
    expect(found.filter((entry) => entry.kind === "checkbox")[0]?.value).toBe("4px")
  })

  it("does not care which screens the instances sit on", () => {
    // The whole point: two screens that resemble nothing are still compared.
    const spread = Array.from({ length: 4 }, (_u, i) =>
      instance("button", `screen-${i}`, `#b${i}`, { "border-radius": "8px" }),
    )

    expect(deriveComponentConventions(spread)[0]).toMatchObject({
      value: "8px",
      agreeing: 4,
    })
  })
})

describe("componentDivergences", () => {
  const conventions = [
    {
      kind: "radio" as const,
      property: "border-radius",
      value: "999px",
      confidence: "high" as const,
      agreeing: 4,
      considered: 5,
      evidenceScreenIds: ["s1"],
    },
  ]

  it("finds the instance that departs, and only that one", () => {
    const found = componentDivergences(
      [
        instance("radio", "s1", "#a", { "border-radius": "999px" }),
        instance("radio", "s2", "#b", { "border-radius": "4px" }),
      ],
      conventions,
    )

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      selector: "#b",
      observedValue: "4px",
      expectedValue: "999px",
    })
  })

  it("flags one radio on a screen whose other radio agrees", () => {
    const found = componentDivergences(
      [
        instance("radio", "s1", "#a", { "border-radius": "999px" }),
        instance("radio", "s1", "#b", { "border-radius": "4px" }),
      ],
      conventions,
    )

    expect(found.map((entry) => entry.selector)).toEqual(["#b"])
  })

  it("says nothing about a kind with no convention", () => {
    expect(
      componentDivergences([instance("checkbox", "s1", "#c", { "border-radius": "0px" })], conventions),
    ).toEqual([])
  })

  it("says nothing about an instance holding no value for the property", () => {
    expect(componentDivergences([instance("radio", "s1", "#a", {})], conventions)).toEqual([])
  })

  it("stays quiet about a habit, and speaks about a standard", () => {
    // Against a real project the unrestricted version derived "buttons are
    // pills" from 23 of 41 and called the other 18 drift. They were two
    // deliberate button shapes, and a 56 percent majority describes the split
    // rather than a rule either side broke.
    const habit = [{ ...conventions[0]!, confidence: "low" as const }]
    const departing = [instance("radio", "s2", "#b", { "border-radius": "4px" })]

    expect(componentDivergences(departing, habit)).toEqual([])
    expect(componentDivergences(departing, conventions)).toHaveLength(1)
  })

  it("is quiet at medium confidence too, which is still not a standard", () => {
    const medium = [{ ...conventions[0]!, confidence: "medium" as const }]

    expect(
      componentDivergences([instance("radio", "s2", "#b", { "border-radius": "4px" })], medium),
    ).toEqual([])
  })

  it("does not ask again about a screen somebody has already excused", () => {
    // An exception is permanent (AGENTS.md section 6). It is recorded on the
    // screen, so every radio on that screen is covered by it.
    const excused = [{ ...conventions[0]!, exceptScreenIds: ["s2"] }]
    const departing = [
      instance("radio", "s2", "#b", { "border-radius": "4px" }),
      instance("radio", "s3", "#c", { "border-radius": "4px" }),
    ]

    expect(componentDivergences(departing, excused).map((entry) => entry.screenId)).toEqual(["s3"])
  })

  it("carries the convention it departs from, so a finding can point at it", () => {
    const stored = [{ ...conventions[0]!, conventionId: "conv1" }]
    const found = componentDivergences(
      [instance("radio", "s2", "#b", { "border-radius": "4px" })],
      stored,
    )

    expect(found[0]?.conventionId).toBe("conv1")
  })

  it("says null for a convention that was never stored", () => {
    const found = componentDivergences(
      [instance("radio", "s2", "#b", { "border-radius": "4px" })],
      conventions,
    )

    expect(found[0]?.conventionId).toBeNull()
  })
})


describe("componentProperty", () => {
  it("reads back the kind and the property it was built from", () => {
    const property = componentProperty("radio", "border-radius")

    expect(property).toBe("radio.border-radius")
    expect(parseComponentProperty(property)).toEqual({
      kind: "radio",
      styleProperty: "border-radius",
    })
  })

  it("round trips every property every kind is judged on", () => {
    for (const kind of COMPONENT_KINDS) {
      for (const property of COMPONENT_PROPERTIES[kind]) {
        expect(parseComponentProperty(componentProperty(kind, property))).toEqual({
          kind,
          styleProperty: property,
        })
      }
    }
  })

  it("is not a component property when it is not one", () => {
    // The other vocabulary, a property no kind is judged on, a kind that does
    // not exist, and a bare CSS property.
    expect(parseComponentProperty("cta.radius")).toBeNull()
    expect(parseComponentProperty("icon.padding")).toBeNull()
    expect(parseComponentProperty("slider.border-radius")).toBeNull()
    expect(parseComponentProperty("border-radius")).toBeNull()
    expect(isComponentProperty("heading.size")).toBe(false)
  })
})

describe("componentConventionLabel", () => {
  it("states the convention as a sentence about the product", () => {
    expect(componentConventionLabel("radio", "border-radius", "999px")).toBe(
      "Radio buttons have a corner radius of 999px",
    )
    expect(componentConventionLabel("icon", "color", "rgb(0, 0, 0)")).toBe(
      "Icons have a colour of rgb(0, 0, 0)",
    )
  })

  it("keeps the copy rules: no stop, no em dash, no exclamation", () => {
    const label = componentConventionLabel("button", "font-size", "16px")

    expect(label).not.toMatch(/[.!\u2014]/)
  })
})
