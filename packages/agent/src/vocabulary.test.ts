import { isNamedProperty, propertyReading, FINDING_KINDS } from "@drift/core"
import { describe, expect, it } from "vitest"

import { PROFILE_PROPERTIES } from "./profile"

describe("every property a convention can be stated over has a name", () => {
  it("is named in the vocabulary", () => {
    // The other half of the guard in `@drift/core`. Adding a row to
    // PROFILE_PROPERTIES without naming it here puts `content.gap` in front of
    // somebody, which is the thing the vocabulary exists to stop.
    const unnamed = PROFILE_PROPERTIES.map((entry) => entry.property).filter(
      (property) => !isNamedProperty(property),
    )

    expect(unnamed).toEqual([])
  })

  it("is filed under a kind the filter offers", () => {
    const kinds = new Set<string>(FINDING_KINDS)

    for (const entry of PROFILE_PROPERTIES) {
      expect(kinds.has(propertyReading(entry.property).kind)).toBe(true)
    }
  })
})
