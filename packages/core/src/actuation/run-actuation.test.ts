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
    const result = await run([{ finding: TOKEN_FINDING, nearestTokenDistance: 0.04 }])

    expect(result.opened).toHaveLength(1)
    expect(result.opened[0]?.prNumber).toBe(1)
    expect(github.pulls[0]?.head).toBe(fixBranchName(TOKEN_FINDING.id))
    expect(github.branches.get(fixBranchName(TOKEN_FINDING.id))?.get("app/pricing/page.tsx")).toContain(
      `backgroundColor: "${NEAREST_TOKEN.value}"`,
    )
  })

  it("says it opened the pull request without being asked", async () => {
    await run([{ finding: TOKEN_FINDING, nearestTokenDistance: 0.04 }])

    expect(github.pulls[0]?.body).toContain("without being asked")
    expect(github.pulls[0]?.body).toContain("Opened by Drift.")
  })

  it("stores the number on the finding", async () => {
    await run([{ finding: TOKEN_FINDING, nearestTokenDistance: 0.04 }])

    expect(repositories.stored.findings[0]?.prNumber).toBe(1)
  })

  it("leaves everything the boundary refused waiting, with its reason", async () => {
    const result = await run([{ finding: TOKEN_FINDING, nearestTokenDistance: 0.9 }])

    expect(result.opened).toEqual([])
    expect(result.waiting[0]?.reason).toMatch(/a choice somebody made/)
    expect(github.writes).toEqual([])
  })

  it("opens nothing against a repo that is not on the allowlist", async () => {
    process.env.GITHUB_REPO_ALLOWLIST = "someone-else/web"

    const result = await run([{ finding: TOKEN_FINDING, nearestTokenDistance: 0.01 }])

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
    const candidate = { finding: TOKEN_FINDING, nearestTokenDistance: 0.04 }
    await run([candidate])

    const again = await run([
      { finding: repositories.stored.findings[0]!, nearestTokenDistance: 0.04 },
    ])

    expect(again.opened).toEqual([])
    expect(again.waiting[0]?.reason).toContain("already carries pull request 1")
    expect(github.pulls).toHaveLength(1)
  })
})
