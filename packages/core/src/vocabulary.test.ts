import { describe, expect, it } from "vitest"

import { COMPONENT_KINDS, COMPONENT_PROPERTIES, componentProperty } from "./analysis/components"
import { STYLE_PROPERTIES } from "./constants"
import {
  FINDING_KINDS,
  FINDING_KIND_LABEL,
  isNamedProperty,
  propertyReading,
} from "./vocabulary"

describe("propertyReading", () => {
  it("names every style property Drift records", () => {
    // The guard that matters. A property added to the extraction without a
    // name here would show a person a CSS keyword in a list meant to be read.
    const unnamed = STYLE_PROPERTIES.filter((property) => !isNamedProperty(property))

    expect(unnamed).toEqual([])
  })

  it("turns both vocabularies into one", () => {
    expect(propertyReading("background-color")).toEqual({
      kind: "colour",
      label: "Background colour",
    })
    expect(propertyReading("cta.voice")).toEqual({ kind: "wording", label: "Button voice" })
  })

  it("puts a radius and a button's radius in the same kind", () => {
    // Unrelated names, one decision. This is why it is a table and not a rule.
    expect(propertyReading("border-radius").kind).toBe(propertyReading("cta.radius").kind)
  })

  it("gives every kind a label", () => {
    for (const kind of FINDING_KINDS) {
      expect(FINDING_KIND_LABEL[kind]).toBeTruthy()
    }
  })

  it("only ever answers with a kind the filter offers", () => {
    const kinds = new Set<string>(FINDING_KINDS)
    for (const property of STYLE_PROPERTIES) {
      expect(kinds.has(propertyReading(property).kind)).toBe(true)
    }
  })

  it("reads an unknown property as itself rather than as nothing", () => {
    expect(propertyReading("stroke-dasharray").label).toBe("stroke-dasharray")
  })

  it("names a component property from its two halves", () => {
    expect(propertyReading("radio.border-radius")).toEqual({
      kind: "shape",
      label: "Radio button corner radius",
    })
    expect(propertyReading("icon.color")).toEqual({ kind: "colour", label: "Icon colour" })
  })

  it("files a component property under the kind its CSS half belongs to", () => {
    // A button's corner radius and a container's corner radius are the same
    // decision about different things, which is what the table already says
    // about `cta.radius` and `border-radius`.
    expect(propertyReading("button.border-radius").kind).toBe(propertyReading("border-radius").kind)
  })

  it("names every component property any convention can be stated over", () => {
    const unnamed = COMPONENT_KINDS.flatMap((kind) =>
      COMPONENT_PROPERTIES[kind]
        .map((property) => componentProperty(kind, property))
        .filter((property) => !isNamedProperty(property)),
    )

    expect(unnamed).toEqual([])
  })

  it("only ever answers with a kind the filter offers, components included", () => {
    const kinds = new Set<string>(FINDING_KINDS)

    for (const kind of COMPONENT_KINDS) {
      for (const property of COMPONENT_PROPERTIES[kind]) {
        const reading = propertyReading(componentProperty(kind, property))
        expect(kinds.has(reading.kind)).toBe(true)
        expect(reading.label).not.toMatch(/[.\-]/)
        expect(reading.label[0]).toBe(reading.label[0]?.toUpperCase())
      }
    }
  })

  it("writes every name in sentence case, with no dots or hyphens", () => {
    for (const property of STYLE_PROPERTIES) {
      const { label } = propertyReading(property)
      expect(label).not.toMatch(/[.\-]/)
      expect(label[0]).toBe(label[0]?.toUpperCase())
    }
  })
})
