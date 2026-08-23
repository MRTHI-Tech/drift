import { describe, expect, it } from "vitest"

import { PATTERN_FINDING, TOKEN_FINDING } from "./actuation/fixtures"
import type { Finding, FindingStatus } from "./types"
import { claimedFixes, verifyFixes } from "./verification"

function resolved(
  id: string,
  status: FindingStatus,
  dedupeKey = `${id}-key`,
  screenId = "screen-pricing",
  prNumber: number | null = 3,
): Finding {
  return { ...structuredClone(TOKEN_FINDING), id, status, dedupeKey, screenId, prNumber }
}

const routeOf = new Map([["screen-pricing", "/pricing"]])
const rendered = new Set(["/pricing"])

const verify = (claimed: Finding[], observed: string[]) =>
  verifyFixes({ claimed, observed: new Set(observed), routes: rendered, routeOf })

describe("verifyFixes", () => {
  it("confirms a fix when the value it cited is gone", () => {
    const finding = resolved("f1", "resolved_conform")

    expect(verify([finding], []).fixed.map((entry) => entry.id)).toEqual(["f1"])
  })

  it("catches a fix that did not take", () => {
    // The pull request was opened, and the product still renders the value.
    const finding = resolved("f1", "resolved_conform")

    const result = verify([finding], ["f1-key"])

    expect(result.unfixed.map((entry) => entry.id)).toEqual(["f1"])
    expect(result.fixed).toEqual([])
  })

  it("says nothing about a route the run did not render", () => {
    const finding = resolved("f1", "resolved_conform", "f1-key", "screen-elsewhere")

    const result = verify([finding], [])

    expect(result.unchecked.map((entry) => entry.id)).toEqual(["f1"])
    expect(result.fixed).toEqual([])
    expect(result.unfixed).toEqual([])
  })

  it("never treats a missing route as a pass", () => {
    const result = verifyFixes({
      claimed: [resolved("f1", "resolved_conform")],
      observed: new Set(),
      routes: new Set(),
      routeOf,
    })

    expect(result.fixed).toEqual([])
    expect(result.unchecked).toHaveLength(1)
  })

  it("leaves a screen somebody moved the convention to alone", () => {
    // `update siblings` means this screen was right. Its value staying is the
    // success, so checking for its absence would have it backwards.
    expect(verify([resolved("f1", "resolved_update_siblings")], ["f1-key"])).toEqual({
      fixed: [],
      unfixed: [],
      unchecked: [],
    })
  })

  it("never reopens an exception, which is permanent", () => {
    expect(verify([resolved("f1", "resolved_exception")], ["f1-key"]).unfixed).toEqual([])
  })

  it("ignores a dismissal", () => {
    expect(verify([resolved("f1", "dismissed")], ["f1-key"]).unfixed).toEqual([])
  })

  it("checks a finding nobody closed, because merging does not close one", () => {
    // The ordinary case. A pull request was merged, the finding stayed open,
    // and whether it worked is a question only the render answers.
    const result = verify([resolved("f1", "open")], ["f1-key"])

    expect(result.unfixed.map((entry) => entry.id)).toEqual(["f1"])
  })

  it("confirms an open finding whose value has gone", () => {
    expect(verify([resolved("f1", "open")], []).fixed.map((entry) => entry.id)).toEqual(["f1"])
  })

  it("sorts a mixed run into three answers", () => {
    const result = verify(
      [
        resolved("gone", "resolved_conform", "gone-key"),
        resolved("still", "resolved_conform", "still-key"),
        resolved("elsewhere", "resolved_conform", "elsewhere-key", "screen-elsewhere"),
      ],
      ["still-key"],
    )

    expect(result.fixed.map((f) => f.id)).toEqual(["gone"])
    expect(result.unfixed.map((f) => f.id)).toEqual(["still"])
    expect(result.unchecked.map((f) => f.id)).toEqual(["elsewhere"])
  })
})

describe("claimedFixes", () => {
  it("takes token findings carrying a pull request, whether or not anybody closed them", () => {
    const findings = [
      resolved("conformed", "resolved_conform"),
      resolved("open-with-pr", "open"),
      resolved("no-pr", "open", "no-pr-key", "screen-pricing", null),
      resolved("excepted", "resolved_exception"),
      resolved("dismissed", "dismissed"),
      { ...structuredClone(PATTERN_FINDING), id: "pattern", prNumber: 3 },
    ]

    expect(claimedFixes(findings).map((entry) => entry.id)).toEqual([
      "conformed",
      "open-with-pr",
    ])
  })

  it("never asks about a finding no fix was ever proposed for", () => {
    expect(claimedFixes([resolved("f1", "open", "k", "screen-pricing", null)])).toEqual([])
  })
})
