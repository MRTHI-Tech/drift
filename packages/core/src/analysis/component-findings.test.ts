import { describe, expect, it } from "vitest"

import { dedupeKey } from "../dedupe"
import type { Finding, FindingStatus } from "../types"
import type { FindingRepository } from "../repositories/findings"
import type { ComponentDivergence } from "./components"
import {
  componentDedupeKey,
  componentFinding,
  componentSentence,
  persistComponentFindings,
} from "./component-findings"

function divergence(overrides: Partial<ComponentDivergence> = {}): ComponentDivergence {
  return {
    kind: "radio",
    property: "border-radius",
    conventionId: "conv1",
    screenId: "screen1",
    selector: "body > input:nth-of-type(2)",
    observedValue: "4px",
    expectedValue: "999px",
    agreeing: 16,
    considered: 17,
    ...overrides,
  }
}

const INPUT = { projectId: "proj1", runId: "run1", route: "/settings" }

describe("componentFinding", () => {
  it("answers to a convention rather than to the token file", () => {
    const finding = componentFinding({ ...INPUT, divergence: divergence() })

    expect(finding.type).toBe("pattern")
    expect(finding.conventionId).toBe("conv1")
    expect(finding.status).toBe("open")
    expect(finding.prNumber).toBeNull()
  })

  it("names the property in the vocabulary the convention is stored under", () => {
    const finding = componentFinding({ ...INPUT, divergence: divergence() })

    expect(finding.evidence.property).toBe("radio.border-radius")
    expect(finding.evidence.observedValue).toBe("4px")
    expect(finding.evidence.expectedValue).toBe("999px")
    expect(finding.evidence.expectedSource).toBe("Radio buttons")
  })

  it("cites the element the value was read from", () => {
    const finding = componentFinding({ ...INPUT, divergence: divergence() })

    expect(finding.evidence.selector).toBe("body > input:nth-of-type(2)")
  })

  it("claims no sibling screens, because the siblings are instances", () => {
    // The same screen can hold one radio that agrees and one that does not, so
    // a list of screen ids here would contradict itself.
    expect(componentFinding({ ...INPUT, divergence: divergence() }).evidence.siblingScreenIds).toEqual(
      [],
    )
  })

  it("is louder about a colour than about a corner", () => {
    const colour = componentFinding({
      ...INPUT,
      divergence: divergence({ kind: "icon", property: "color" }),
    })
    const corner = componentFinding({ ...INPUT, divergence: divergence() })

    expect(colour.severity).toBeGreaterThan(corner.severity)
  })

  it("writes its own line, because no model wrote one", () => {
    const finding = componentFinding({ ...INPUT, divergence: divergence() })

    expect(finding.evidence.sentence).toBe(
      "This radio button has a corner radius of 4px. 16 of 17 radio buttons in this product have 999px.",
    )
  })

  it("is the same document every run, apart from when it was raised", () => {
    const first = componentFinding({ ...INPUT, divergence: divergence(), createdAt: new Date(1) })
    const second = componentFinding({ ...INPUT, divergence: divergence(), createdAt: new Date(2) })

    expect(first.dedupeKey).toBe(second.dedupeKey)
  })
})

describe("componentSentence", () => {
  it("states the evidence and passes no verdict", () => {
    const line = componentSentence(divergence({ kind: "icon", property: "color", observedValue: "rgb(1, 1, 1)", expectedValue: "rgb(0, 0, 0)" }))

    expect(line).toBe(
      "This icon has a colour of rgb(1, 1, 1). 16 of 17 icons in this product have rgb(0, 0, 0).",
    )
    expect(line).not.toMatch(/wrong|should|inconsisten/i)
  })

  it("carries no em dash and no exclamation (AGENTS.md section 6)", () => {
    expect(componentSentence(divergence())).not.toMatch(/[!—]/)
  })
})

describe("componentDedupeKey", () => {
  it("is the key AGENTS.md section 2 locks, over the dotted property", () => {
    expect(componentDedupeKey("proj1", "/settings", divergence())).toBe(
      dedupeKey({
        projectId: "proj1",
        route: "/settings",
        property: "radio.border-radius",
        observedValue: "4px",
      }),
    )
  })

  it("keeps two kinds apart when they render the same wrong value", () => {
    // One kind of control looking wrong is not evidence about another.
    const radio = componentDedupeKey("proj1", "/settings", divergence())
    const checkbox = componentDedupeKey("proj1", "/settings", divergence({ kind: "checkbox" }))

    expect(radio).not.toBe(checkbox)
  })

  it("is one finding for two elements of one kind on one route", () => {
    const first = componentDedupeKey("proj1", "/settings", divergence({ selector: "#a" }))
    const second = componentDedupeKey("proj1", "/settings", divergence({ selector: "#b" }))

    expect(first).toBe(second)
  })
})

/** A findings repository that remembers keys, which is all this needs. */
function fakeFindings(existing: { dedupeKey: string; status: FindingStatus }[] = []) {
  const written: Finding[] = []
  const keys = new Map(existing.map((entry) => [entry.dedupeKey, entry.status]))

  const repository = {
    async createIfNew(input: Omit<Finding, "id">) {
      const held = keys.get(input.dedupeKey)
      if (held !== undefined) {
        return { created: false, finding: { ...input, id: "existing", status: held } as Finding }
      }
      const finding = { ...input, id: `finding${written.length + 1}` } as Finding
      written.push(finding)
      keys.set(input.dedupeKey, input.status)
      return { created: true, finding }
    },
  } as unknown as FindingRepository

  return { repository, written }
}

describe("persistComponentFindings", () => {
  const routes = new Map([
    ["screen1", "/settings"],
    ["screen2", "/profile"],
  ])

  it("writes every divergence that is not already a finding", async () => {
    const { repository, written } = fakeFindings()

    const result = await persistComponentFindings({
      findings: repository,
      projectId: "proj1",
      runId: "run1",
      divergences: [divergence(), divergence({ screenId: "screen2" })],
      routes,
    })

    expect(result.created).toHaveLength(2)
    expect(result.alreadyKnown).toBe(0)
    expect(written.map((finding) => finding.screenId)).toEqual(["screen1", "screen2"])
  })

  it("raises nothing new for a divergence somebody has already dismissed", async () => {
    // A dismissal is a decision, and findings are never deleted
    // (AGENTS.md section 2).
    const known = componentDedupeKey("proj1", "/settings", divergence())
    const { repository, written } = fakeFindings([{ dedupeKey: known, status: "dismissed" }])

    const result = await persistComponentFindings({
      findings: repository,
      projectId: "proj1",
      runId: "run1",
      divergences: [divergence()],
      routes,
    })

    expect(result.created).toEqual([])
    expect(result.alreadyKnown).toBe(1)
    expect(written).toEqual([])
  })

  it("counts a second sighting on the same route once", async () => {
    const { repository } = fakeFindings()

    const result = await persistComponentFindings({
      findings: repository,
      projectId: "proj1",
      runId: "run1",
      divergences: [divergence({ selector: "#a" }), divergence({ selector: "#b" })],
      routes,
    })

    expect(result.created).toHaveLength(1)
    expect(result.alreadyKnown).toBe(1)
  })

  it("skips a screen whose route it does not know, rather than guessing one", async () => {
    // The route is half the dedupe key, and a wrong key is a finding that
    // raises itself again on every run forever.
    const { repository, written } = fakeFindings()

    const result = await persistComponentFindings({
      findings: repository,
      projectId: "proj1",
      runId: "run1",
      divergences: [divergence({ screenId: "screen-nobody-loaded" })],
      routes,
    })

    expect(result.created).toEqual([])
    expect(written).toEqual([])
  })
})
