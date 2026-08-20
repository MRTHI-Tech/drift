import { describe, expect, it } from "vitest"

import { causeKey, causeKeyOf, dedupeKey, type DedupeKeyInput } from "./dedupe"

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

describe("causeKey", () => {
  const base = {
    projectId: "proj1",
    property: "background-color",
    observedValue: "rgb(242, 242, 242)",
    expectedValue: "#F0EDE8",
  }

  it("is the same for the same problem on two different screens", () => {
    // The route is not an input, which is the entire point of it.
    expect(causeKey(base)).toBe(causeKey({ ...base }))
  })

  it("separates two screens drifting to the same value from different tokens", () => {
    expect(causeKey(base)).not.toBe(causeKey({ ...base, expectedValue: "#FFFFFF" }))
  })

  it("separates two properties holding the same value", () => {
    expect(causeKey(base)).not.toBe(causeKey({ ...base, property: "color" }))
  })

  it("never crosses projects", () => {
    expect(causeKey(base)).not.toBe(causeKey({ ...base, projectId: "proj2" }))
  })

  it("cannot be confused by where one field ends and the next begins", () => {
    expect(causeKey({ ...base, property: "a", observedValue: "bc" })).not.toBe(
      causeKey({ ...base, property: "ab", observedValue: "c" }),
    )
  })

  it("reads the same key off a finding as off its parts", () => {
    expect(
      causeKeyOf({
        projectId: base.projectId,
        evidence: {
          property: base.property,
          observedValue: base.observedValue,
          expectedValue: base.expectedValue,
        },
      }),
    ).toBe(causeKey(base))
  })
})

