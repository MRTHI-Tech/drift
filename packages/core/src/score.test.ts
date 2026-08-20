import { describe, expect, it } from "vitest"

import {
  computeDriftScore,
  countOpen,
  countOpenProblems,
  driftScoreSeries,
  refreshDriftScore,
  wasOpenAt,
} from "./score"
import { fakeRepositories } from "./actuation/fake-repositories"
import { PATTERN_FINDING, PROJECT, screen } from "./actuation/fixtures"
import type { Finding, Run } from "./types"

function findingAt(
  id: string,
  createdAt: string,
  resolvedAt: string | null,
  status: Finding["status"] = resolvedAt ? "resolved_conform" : "open",
): Finding {
  return {
    ...PATTERN_FINDING,
    id,
    status,
    createdAt: new Date(createdAt),
    resolvedAt: resolvedAt ? new Date(resolvedAt) : null,
  }
}

function runAt(id: string, startedAt: string, finishedAt: string | null): Run {
  return {
    id,
    projectId: PROJECT.id,
    trigger: "scheduled",
    startedAt: new Date(startedAt),
    finishedAt: finishedAt ? new Date(finishedAt) : null,
    routesChecked: 2,
    status: "findings",
    findingIds: [],
    knownFindings: 0,
    error: null,
  }
}

describe("computeDriftScore", () => {
  it("scores a project with nothing open at 100", () => {
    expect(computeDriftScore({ openFindings: 0, screensChecked: 8 })).toBe(100)
  })

  it("scores one open problem per screen checked at 50", () => {
    expect(computeDriftScore({ openFindings: 8, screensChecked: 8 })).toBe(50)
  })

  it("costs less for each problem after the first", () => {
    expect(computeDriftScore({ openFindings: 2, screensChecked: 8 })).toBe(80)
    expect(computeDriftScore({ openFindings: 4, screensChecked: 8 })).toBe(67)
    expect(computeDriftScore({ openFindings: 8, screensChecked: 8 })).toBe(50)
    expect(computeDriftScore({ openFindings: 16, screensChecked: 8 })).toBe(33)
  })

  it("keeps moving however bad things are, which is the whole point", () => {
    // The old score subtracted and hit zero at one problem per screen, so a
    // project at 26 problems and one at 13 read the same, and the first half
    // of fixing it moved nothing. Every one of these is different.
    const scores = [40, 30, 20, 10, 5].map((openFindings) =>
      computeDriftScore({ openFindings, screensChecked: 8 }),
    )

    expect(new Set(scores).size).toBe(scores.length)
    expect(scores).toEqual([...scores].sort((a, b) => a - b))
    expect(scores.every((score) => score > 0)).toBe(true)
  })

  it("never reads as perfect while anything is open", () => {
    expect(computeDriftScore({ openFindings: 1, screensChecked: 1000 })).toBeLessThan(100)
  })

  it("scores a project that has checked nothing at 100", () => {
    expect(computeDriftScore({ openFindings: 0, screensChecked: 0 })).toBe(100)
  })
})

describe("wasOpenAt", () => {
  const at = new Date("2026-08-05T00:00:00Z")

  it("is false before the finding was raised", () => {
    expect(wasOpenAt(findingAt("f1", "2026-08-06T00:00:00Z", null), at)).toBe(false)
  })

  it("is true for a finding raised earlier and never resolved", () => {
    expect(wasOpenAt(findingAt("f1", "2026-08-01T00:00:00Z", null), at)).toBe(true)
  })

  it("is true for a finding resolved after the moment asked about", () => {
    expect(wasOpenAt(findingAt("f1", "2026-08-01T00:00:00Z", "2026-08-07T00:00:00Z"), at)).toBe(true)
  })

  it("is false for a finding already resolved by then", () => {
    expect(wasOpenAt(findingAt("f1", "2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z"), at)).toBe(
      false,
    )
  })
})

describe("countOpen", () => {
  it("counts only findings still waiting for a decision", () => {
    expect(
      countOpen([
        findingAt("f1", "2026-08-01T00:00:00Z", null),
        findingAt("f2", "2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z"),
        findingAt("f3", "2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z", "dismissed"),
      ]),
    ).toBe(1)
  })
})

describe("countOpenProblems", () => {
  it("counts twelve sightings of one problem as one", () => {
    const same = Array.from({ length: 12 }, (_unused, index) =>
      findingAt(`f${index}`, "2026-08-01T00:00:00Z", null),
    )

    expect(countOpen(same)).toBe(12)
    expect(countOpenProblems(same)).toBe(1)
  })

  it("keeps two different problems apart", () => {
    const one = findingAt("f1", "2026-08-01T00:00:00Z", null)
    const two = {
      ...findingAt("f2", "2026-08-01T00:00:00Z", null),
      evidence: { ...one.evidence, observedValue: "Something else" },
    }

    expect(countOpenProblems([one, two])).toBe(2)
  })

  it("ignores anything already decided", () => {
    expect(
      countOpenProblems([findingAt("f1", "2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z")]),
    ).toBe(0)
  })
})

describe("driftScoreSeries", () => {
  const findings = [
    findingAt("f1", "2026-08-01T09:00:00Z", null),
    findingAt("f2", "2026-08-02T09:00:00Z", "2026-08-03T12:00:00Z"),
  ]

  it("reconstructs the score as it stood at the end of each run, oldest first", () => {
    const points = driftScoreSeries(
      [
        runAt("r2", "2026-08-02T10:00:00Z", "2026-08-02T10:05:00Z"),
        runAt("r1", "2026-08-01T10:00:00Z", "2026-08-01T10:05:00Z"),
        runAt("r3", "2026-08-04T10:00:00Z", "2026-08-04T10:05:00Z"),
      ],
      findings,
      new Map([
        ["r1", 4],
        ["r2", 4],
        ["r3", 4],
      ]),
    )

    expect(points.map((point) => point.runId)).toEqual(["r1", "r2", "r3"])
    // One cause: both fixtures are the same property and value, so two
    // sightings of it count once, the same way the findings page counts them.
    expect(points.map((point) => point.openFindings)).toEqual([1, 1, 1])
    expect(points.map((point) => point.score)).toEqual([80, 80, 80])
  })

  it("scores a run that captured no screens against the last count that was not zero", () => {
    const points = driftScoreSeries(
      [
        runAt("r1", "2026-08-01T10:00:00Z", "2026-08-01T10:05:00Z"),
        runAt("r2", "2026-08-02T10:00:00Z", "2026-08-02T10:05:00Z"),
      ],
      findings,
      new Map([["r1", 4]]),
    )

    expect(points[1]?.screensChecked).toBe(4)
    expect(points[1]?.score).toBe(80)
  })

  it("times a run that never finished by when it started", () => {
    const points = driftScoreSeries(
      [runAt("r1", "2026-08-01T10:00:00Z", null)],
      findings,
      new Map([["r1", 4]]),
    )

    expect(points[0]?.at).toEqual(new Date("2026-08-01T10:00:00Z"))
  })
})

describe("refreshDriftScore", () => {
  const twoScreens = [screen(), screen({ id: "screen-step-1", route: "/checkout/step-1" })]

  it("stores the score and reports that it moved", async () => {
    const repositories = fakeRepositories({
      projects: [{ ...PROJECT, driftScore: 0 }],
      screens: twoScreens,
      findings: [PATTERN_FINDING],
    })

    const refreshed = await refreshDriftScore(PROJECT.id, repositories)

    expect(refreshed).toMatchObject({ openFindings: 1, screensChecked: 2, score: 67, changed: true })
    expect(repositories.stored.projects[0]?.driftScore).toBe(67)
  })

  it("writes nothing when the project already carries this score", async () => {
    const repositories = fakeRepositories({
      projects: [{ ...PROJECT, driftScore: 67 }],
      screens: twoScreens,
      findings: [PATTERN_FINDING],
    })

    expect(await refreshDriftScore(PROJECT.id, repositories)).toMatchObject({
      score: 67,
      changed: false,
    })
  })

  it("counts a route rendered twice once", async () => {
    const repositories = fakeRepositories({
      projects: [{ ...PROJECT, driftScore: 0 }],
      screens: [screen(), screen({ id: "screen-pricing-again" })],
      findings: [PATTERN_FINDING],
    })

    expect(await refreshDriftScore(PROJECT.id, repositories)).toMatchObject({
      screensChecked: 1,
      score: 50,
    })
  })

  it("refuses to score a project that is not there", async () => {
    await expect(refreshDriftScore("nope", fakeRepositories())).rejects.toThrow(
      "There is no project nope to score.",
    )
  })
})
