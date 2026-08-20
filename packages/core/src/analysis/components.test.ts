import { describe, expect, it } from "vitest"

import type { ElementStyles } from "../types"
import {
  COMPONENT_KINDS,
  COMPONENT_KIND_LABEL,
  COMPONENT_PROPERTIES,
  componentKind,
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
      expect(COMPONENT_PROPERTIES[kind].length).toBeGreaterThan(0)
    }
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
