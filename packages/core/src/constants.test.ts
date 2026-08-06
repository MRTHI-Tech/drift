import { describe, expect, it } from "vitest"

import { COLLECTIONS, MIN_SCREENS_PER_CONVENTION } from "./constants"

describe("constants", () => {
  it("names every collection locked in AGENTS.md section 2", () => {
    expect(Object.values(COLLECTIONS)).toEqual([
      "projects",
      "runs",
      "screens",
      "archetypes",
      "conventions",
      "findings",
      "resolutions",
    ])
  })

  it("requires three agreeing screens for a convention", () => {
    expect(MIN_SCREENS_PER_CONVENTION).toBe(3)
  })
})
