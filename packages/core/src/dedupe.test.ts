import { describe, expect, it } from "vitest"

import { dedupeKey, type DedupeKeyInput } from "./dedupe"

const base: DedupeKeyInput = {
  projectId: "proj_1",
  route: "/pricing",
  property: "cta.label",
  observedValue: "Next",
}

describe("dedupeKey", () => {
  it("returns the same key for the same inputs", () => {
    expect(dedupeKey(base)).toBe(dedupeKey({ ...base }))
  })

  it("does not depend on the order the input object was built in", () => {
    const reordered: DedupeKeyInput = {
      observedValue: base.observedValue,
      property: base.property,
      route: base.route,
      projectId: base.projectId,
    }
    expect(dedupeKey(reordered)).toBe(dedupeKey(base))
  })

  it("returns a different key when observedValue changes", () => {
    expect(dedupeKey({ ...base, observedValue: "Continue" })).not.toBe(dedupeKey(base))
  })

  it("returns a different key when any other input changes", () => {
    const keys = [
      dedupeKey(base),
      dedupeKey({ ...base, projectId: "proj_2" }),
      dedupeKey({ ...base, route: "/checkout" }),
      dedupeKey({ ...base, property: "heading.size" }),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("keeps inputs distinct when their boundaries shift", () => {
    const left = dedupeKey({ ...base, route: "/a", property: "b" })
    const right = dedupeKey({ ...base, route: "/ab", property: "" })
    expect(left).not.toBe(right)
  })

  it("is a hex sha256 digest", () => {
    expect(dedupeKey(base)).toMatch(/^[0-9a-f]{64}$/)
  })
})
