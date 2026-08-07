import { describe, expect, it } from "vitest"

import { archetypeCentroid, clusterScreens, type EmbeddedScreen } from "./cluster"
import { cosineSimilarity, signatureText } from "./embedding"
import { stepScreen, stepScreens } from "./fixtures"

/**
 * Vectors near a direction, so a cluster can be built without calling an
 * embedder. `spread` pushes a screen away from the family.
 */
function vector(direction: number, spread = 0): number[] {
  const base = [0, 0, 0, 0]
  base[direction] = 1
  base[(direction + 1) % 4] = spread
  return base
}

function screen(id: string, direction: number, spread = 0, overrides: Partial<EmbeddedScreen> = {}): EmbeddedScreen {
  return {
    screenId: id,
    route: `/${id}`,
    viewport: "mobile",
    embedding: vector(direction, spread),
    proposedLabel: "Onboarding step",
    ...overrides,
  }
}

describe("clusterScreens", () => {
  it("starts an archetype once enough screens are alike", () => {
    const result = clusterScreens([screen("a", 0), screen("b", 0, 0.05), screen("c", 0, 0.1)], [])

    expect(result.created).toHaveLength(1)
    expect(result.created[0]?.screenIds).toEqual(["a", "b", "c"])
    expect(result.created[0]?.proposedLabel).toBe("Onboarding step")
    expect(result.unassigned).toEqual([])
  })

  it("leaves a family below the floor unassigned rather than naming it", () => {
    const result = clusterScreens([screen("a", 0), screen("b", 0, 0.05)], [])

    expect(result.created).toEqual([])
    expect(result.unassigned).toEqual(["a", "b"])
  })

  it("leaves a screen that is like nothing unassigned", () => {
    const result = clusterScreens(
      [screen("a", 0), screen("b", 0, 0.05), screen("c", 0, 0.1), screen("odd", 2)],
      [],
    )

    expect(result.unassigned).toEqual(["odd"])
    expect(result.created[0]?.screenIds).not.toContain("odd")
  })

  it("joins an archetype that already exists rather than starting a rival", () => {
    const result = clusterScreens(
      [screen("a", 0), screen("b", 0, 0.05), screen("c", 0, 0.1)],
      [
        {
          archetypeId: "arch1",
          label: "Onboarding step",
          viewport: "mobile",
          centroid: vector(0, 0.02),
        },
      ],
    )

    expect(result.created).toEqual([])
    expect(result.assigned.map((assignment) => assignment.archetypeId)).toEqual([
      "arch1",
      "arch1",
      "arch1",
    ])
  })

  it("never puts one viewport's screens into another viewport's archetype", () => {
    const result = clusterScreens(
      [screen("a", 0, 0, { viewport: "desktop" })],
      [{ archetypeId: "arch1", label: "Onboarding step", viewport: "mobile", centroid: vector(0) }],
    )

    expect(result.assigned).toEqual([])
    expect(result.unassigned).toEqual(["a"])
  })

  it("never clusters two viewports together", () => {
    const mixed = [
      screen("m1", 0),
      screen("m2", 0, 0.05),
      screen("d1", 0, 0, { viewport: "desktop" }),
      screen("d2", 0, 0.05, { viewport: "desktop" }),
    ]

    const result = clusterScreens(mixed, [])

    expect(result.created).toEqual([])
    expect(result.unassigned).toHaveLength(4)
  })

  it("leaves a screen with no vector unassigned rather than guessing", () => {
    const result = clusterScreens(
      [screen("a", 0), screen("b", 0, 0.05), screen("c", 0, 0.1), { ...screen("d", 0), embedding: [] }],
      [],
    )

    expect(result.unassigned).toContain("d")
  })

  it("reports every similarity it measured, so the threshold can be tuned", () => {
    const result = clusterScreens(
      [screen("a", 0)],
      [{ archetypeId: "arch1", label: "Step", viewport: "mobile", centroid: vector(0) }],
    )

    expect(result.measured).toEqual([{ screenId: "a", archetypeId: "arch1", similarity: 1 }])
  })
})

describe("archetypeCentroid", () => {
  it("sits between the vectors it was built from", () => {
    const centre = archetypeCentroid([vector(0), vector(0, 0.2)])

    expect(cosineSimilarity(centre, vector(0))).toBeGreaterThan(0.99)
  })

  it("is empty for a family with no vectors", () => {
    expect(archetypeCentroid([])).toEqual([])
  })
})

describe("signatureText", () => {
  it("leaves the route out, so two steps of one flow read alike", () => {
    const first = signatureText(stepScreen(2).signature!)
    const second = signatureText(stepScreen(3).signature!)

    expect(first).not.toContain("/onboarding")
    expect(first).toBe(second.replace("Step 3", "Step 2"))
  })

  it("encodes the same signature the same way every time", () => {
    const [screenOne] = stepScreens()

    expect(signatureText(screenOne!.signature!)).toBe(signatureText(stepScreen(1).signature!))
  })

  it("says what the screen offers and how its type is ordered", () => {
    const text = signatureText(stepScreen(6).signature!)

    expect(text).toContain("viewport: mobile")
    expect(text).toContain('button "Next"')
    expect(text).toContain("20/700")
  })
})
