/**
 * The unprompted path: what a run does with its own findings.
 *
 * The tests that matter here are the ones about restraint. A run that opens a
 * pull request nobody asked for is only acceptable while the boundary holds,
 * so most of this file is about the cases where nothing goes out.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { fixBranchName } from "./constants"
import { fakeGitHub, type FakeGitHub } from "./fake-github"
import { fakeRepositories, type FakeRepositories } from "./fake-repositories"
import {
  NEAREST_TOKEN,
  PATTERN_FINDING,
  PROJECT,
  SOURCE_FILES,
  TOKEN_FINDING,
  screen,
} from "./fixtures"
import type { PatchPlan } from "./patch"
import { actuationCandidates, openAutonomousPullRequests } from "./run-actuation"

const REPO_FILES = Object.fromEntries(SOURCE_FILES.map((file) => [file.path, file.text]))

let repositories: FakeRepositories
let github: FakeGitHub
const held = process.env.GITHUB_REPO_ALLOWLIST

beforeEach(() => {
  process.env.GITHUB_REPO_ALLOWLIST = "acme/web"
  github = fakeGitHub(REPO_FILES)
  repositories = fakeRepositories({
    projects: [PROJECT],
    findings: [structuredClone(TOKEN_FINDING), structuredClone(PATTERN_FINDING)],
    screens: [screen({ screenshotPath: "no-screenshot-in-tests" })],
  })
})

afterEach(() => {
  if (held === undefined) delete process.env.GITHUB_REPO_ALLOWLIST
  else process.env.GITHUB_REPO_ALLOWLIST = held
})

const run = (candidates: Parameters<typeof openAutonomousPullRequests>[0]["candidates"]) =>
  openAutonomousPullRequests({
    octokit: github.octokit,
    project: PROJECT,
    candidates,
    repositories,
  })

/**
 * A finding whose value no source file writes, which is what sends a run to
 * the Fixer: the mechanical patcher can only match a literal, and there is no
 * literal here to match.
 */
const UNWRITTEN_FINDING = {
  ...TOKEN_FINDING,
  id: "finding-unwritten",
  evidence: { ...TOKEN_FINDING.evidence, observedValue: "rgb(1, 2, 3)" },
}

/** What the Fixer's gate would have returned, had a model been in the loop. */
function fixerPlan(): PatchPlan {
  const file = SOURCE_FILES[0]!
  return {
    kind: "value",
    author: "model",
    from: "rgb(1, 2, 3)",
    to: NEAREST_TOKEN.value,
    files: [
      {
        path: file.path,
        before: file.text,
        after: file.text.replace("#FF0000", NEAREST_TOKEN.value),
        occurrences: 1,
      },
    ],
    occurrences: 1,
    blocked: null,
  }
}

describe("the Fixer, on a finding no substitution could reach", () => {
  const close = new Map([[UNWRITTEN_FINDING.id, 0.05]])

  beforeEach(() => {
    repositories = fakeRepositories({
      projects: [PROJECT],
      findings: [structuredClone(UNWRITTEN_FINDING)],
      screens: [screen({ screenshotPath: "no-screenshot-in-tests" })],
    })
  })

  const runWithFixer = (proposeFix: Parameters<typeof openAutonomousPullRequests>[0]["proposeFix"]) =>
    openAutonomousPullRequests({
      octokit: github.octokit,
      project: PROJECT,
      candidates: actuationCandidates([UNWRITTEN_FINDING], close),
      repositories,
      proposeFix,
    })

  it("is not asked at all while a mechanical patch is possible", async () => {
    let asked = 0
    await openAutonomousPullRequests({
      octokit: github.octokit,
      project: PROJECT,
      candidates: actuationCandidates([TOKEN_FINDING], new Map([[TOKEN_FINDING.id, 0.05]])),
      repositories: fakeRepositories({
        projects: [PROJECT],
        findings: [structuredClone(TOKEN_FINDING)],
        screens: [screen({ screenshotPath: "no-screenshot-in-tests" })],
      }),
      proposeFix: async () => {
        asked += 1
        return { plan: null, reasons: [] }
      },
    })

    expect(asked).toBe(0)
  })

  it("is told why the mechanical patcher gave up", async () => {
    let blocked = ""
    await runWithFixer(async (request) => {
      blocked = request.blocked
      return { plan: null, reasons: [] }
    })

    expect(blocked).toContain("rgb(1, 2, 3)")
  })

  it("opens what it proposes, as a draft", async () => {
    const result = await runWithFixer(async () => ({ plan: fixerPlan(), reasons: [] }))

    expect(result.opened).toHaveLength(1)
    expect(github.pulls).toHaveLength(1)
    expect(github.pulls[0]?.draft).toBe(true)
    expect(github.pulls[0]?.head).toBe(fixBranchName(UNWRITTEN_FINDING.id))
  })

  it("leaves the finding waiting when the Fixer declines", async () => {
    const result = await runWithFixer(async () => ({
      plan: null,
      reasons: ["The Fixer said: the value is composed at runtime."],
    }))

    expect(result.opened).toHaveLength(0)
    expect(result.waiting[0]?.reason).toContain("rgb(1, 2, 3)")
    expect(github.pulls).toHaveLength(0)
  })

  it("survives a Fixer that falls over, and still reports the finding", async () => {
    const result = await runWithFixer(async () => {
      throw new Error("Gemini is down.")
    })

    expect(result.failed).toHaveLength(0)
    expect(result.waiting).toHaveLength(1)
    expect(github.pulls).toHaveLength(0)
  })

  it("opens nothing at all when no Fixer is wired", async () => {
    const result = await runWithFixer(undefined)

    expect(result.opened).toHaveLength(0)
    expect(result.waiting).toHaveLength(1)
  })
})

/** The same grey on another screen: one cause, two sightings. */
function sighting(id: string, screenId: string, createdAt: string) {
  return {
    ...structuredClone(TOKEN_FINDING),
    id,
    screenId,
    createdAt: new Date(createdAt),
    dedupeKey: id.padEnd(64, "0"),
  }
}

describe("actuationCandidates, on twelve screens with one problem", () => {
  const first = sighting("f-a", "screen-a", "2026-08-07T10:00:00Z")
  const second = sighting("f-b", "screen-b", "2026-08-07T11:00:00Z")
  const third = sighting("f-c", "screen-c", "2026-08-07T12:00:00Z")
  const distances = new Map([
    ["f-a", 0.04],
    ["f-b", 0.09],
    ["f-c", 0.02],
  ])

  it("asks about the cause once rather than about each sighting", () => {
    const candidates = actuationCandidates([first, second, third], distances)

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.siblingFindingIds).toEqual(["f-b", "f-c"])
  })

  it("takes the oldest sighting as the one to fix", () => {
    const shuffled = actuationCandidates([third, first, second], distances)

    expect(shuffled[0]?.finding.id).toBe("f-a")
  })

  it("carries the representative's own distance, not somebody else's", () => {
    expect(actuationCandidates([third, first, second], distances)[0]?.nearestTokenDistance).toBe(
      0.04,
    )
  })

  it("picks the same representative however the findings arrive", () => {
    const one = actuationCandidates([first, second, third], distances)[0]?.finding.id
    const two = actuationCandidates([third, second, first], distances)[0]?.finding.id

    expect(one).toBe(two)
  })

  it("keeps two different problems apart", () => {
    const other = {
      ...sighting("f-d", "screen-d", "2026-08-07T10:30:00Z"),
      evidence: { ...TOKEN_FINDING.evidence, observedValue: "rgb(1, 2, 3)" },
    }

    const candidates = actuationCandidates([first, other], distances)

    expect(candidates).toHaveLength(2)
    expect(candidates.every((candidate) => candidate.siblingFindingIds.length === 0)).toBe(true)
  })

  it("leaves a lone sighting with no siblings", () => {
    expect(actuationCandidates([first], distances)[0]?.siblingFindingIds).toEqual([])
  })
})

describe("a pull request for a cause seen on several screens", () => {
  // Rebuilt per test: opening a pull request writes `prNumber` onto the
  // finding, and a shared object would carry that into the next test and be
  // refused for already having one.
  let first: ReturnType<typeof sighting>
  let second: ReturnType<typeof sighting>

  beforeEach(() => {
    first = sighting("f-a", "screen-pricing", "2026-08-07T10:00:00Z")
    second = sighting("f-b", "screen-two", "2026-08-07T11:00:00Z")
    repositories = fakeRepositories({
      projects: [PROJECT],
      findings: [first, second],
      screens: [
        screen({ id: "screen-pricing", route: "/pricing", screenshotPath: "none" }),
        screen({ id: "screen-two", route: "/checkout", screenshotPath: "none" }),
      ],
    })
  })

  it("opens one pull request, not one per screen", async () => {
    await run(actuationCandidates([first, second], new Map([["f-a", 0.04]])))

    expect(github.pulls).toHaveLength(1)
  })

  it("names every route the value renders on", async () => {
    await run(actuationCandidates([first, second], new Map([["f-a", 0.04]])))

    expect(github.pulls[0]?.body).toContain("/pricing")
    expect(github.pulls[0]?.body).toContain("/checkout")
    expect(github.pulls[0]?.body).toContain("fixes all of them")
  })

  it("writes the number onto every finding the fix closes", async () => {
    await run(actuationCandidates([first, second], new Map([["f-a", 0.04]])))

    const stored = repositories.stored.findings
    expect(stored.find((f) => f.id === "f-a")?.prNumber).toBe(1)
    expect(stored.find((f) => f.id === "f-b")?.prNumber).toBe(1)
  })

  it("says nothing about other screens when there are none", async () => {
    await run(actuationCandidates([first], new Map([["f-a", 0.04]])))

    expect(github.pulls[0]?.body).toContain("Seen on /pricing")
    expect(github.pulls[0]?.body).not.toContain("fixes all of them")
  })
})

describe("actuationCandidates", () => {
  it("asks about token findings that name a token, and about nothing else", () => {
    const candidates = actuationCandidates(
      [TOKEN_FINDING, PATTERN_FINDING],
      new Map([[TOKEN_FINDING.id, 0.04]]),
    )

    expect(candidates.map((candidate) => candidate.finding.id)).toEqual([TOKEN_FINDING.id])
    expect(candidates[0]?.nearestTokenDistance).toBe(0.04)
  })

  it("carries a null distance rather than inventing one", () => {
    const candidates = actuationCandidates([TOKEN_FINDING], new Map())

    expect(candidates[0]?.nearestTokenDistance).toBeNull()
  })
})

describe("openAutonomousPullRequests", () => {
  it("opens the pull request nobody asked for, when the boundary allows it", async () => {
    const result = await run([{ finding: TOKEN_FINDING, siblingFindingIds: [], nearestTokenDistance: 0.04 }])

    expect(result.opened).toHaveLength(1)
    expect(result.opened[0]?.prNumber).toBe(1)
    expect(github.pulls[0]?.head).toBe(fixBranchName(TOKEN_FINDING.id))
    expect(github.branches.get(fixBranchName(TOKEN_FINDING.id))?.get("app/pricing/page.tsx")).toContain(
      `backgroundColor: "${NEAREST_TOKEN.value}"`,
    )
  })

  it("says it opened the pull request without being asked", async () => {
    await run([{ finding: TOKEN_FINDING, siblingFindingIds: [], nearestTokenDistance: 0.04 }])

    expect(github.pulls[0]?.body).toContain("without being asked")
    expect(github.pulls[0]?.body).toContain("Opened by Drift.")
  })

  it("stores the number on the finding", async () => {
    await run([{ finding: TOKEN_FINDING, siblingFindingIds: [], nearestTokenDistance: 0.04 }])

    expect(repositories.stored.findings[0]?.prNumber).toBe(1)
  })

  it("leaves everything the boundary refused waiting, with its reason", async () => {
    const result = await run([{ finding: TOKEN_FINDING, siblingFindingIds: [], nearestTokenDistance: 0.9 }])

    expect(result.opened).toEqual([])
    expect(result.waiting[0]?.reason).toMatch(/a choice somebody made/)
    expect(github.writes).toEqual([])
  })

  it("opens nothing against a repo that is not on the allowlist", async () => {
    process.env.GITHUB_REPO_ALLOWLIST = "someone-else/web"

    const result = await run([{ finding: TOKEN_FINDING, siblingFindingIds: [], nearestTokenDistance: 0.01 }])

    expect(result.opened).toEqual([])
    expect(result.failed).toEqual([])
    expect(result.waiting[0]?.reason).toMatch(/not on GITHUB_REPO_ALLOWLIST/)
    // Not one request, not even the read of the repo's source.
    expect(github.writes).toEqual([])
  })

  it("does nothing at all when a run raised nothing to consider", async () => {
    const result = await run([])

    expect(result).toEqual({ considered: 0, opened: [], waiting: [], failed: [] })
    expect(github.writes).toEqual([])
  })

  it("never opens a second pull request for the same finding", async () => {
    const candidate = { finding: TOKEN_FINDING, siblingFindingIds: [], nearestTokenDistance: 0.04 }
    await run([candidate])

    const again = await run([
      { finding: repositories.stored.findings[0]!, siblingFindingIds: [], nearestTokenDistance: 0.04 },
    ])

    expect(again.opened).toEqual([])
    expect(again.waiting[0]?.reason).toContain("already carries pull request 1")
    expect(github.pulls).toHaveLength(1)
  })
})
