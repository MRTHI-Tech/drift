import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { Archetype } from "../types"
import { RULES_BRANCH, RULES_HEADER, RULES_PATH, fixBranchName } from "./constants"
import { fakeGitHub, type FakeGitHub } from "./fake-github"
import { fakeRepositories, type FakeRepositories } from "./fake-repositories"
import {
  CTA_LABEL_CONVENTION,
  NEAREST_TOKEN,
  PATTERN_FINDING,
  PROJECT,
  SOURCE_FILES,
  TOKEN_FINDING,
  screen,
} from "./fixtures"
import { ResolutionError, ResolutionNotFoundError, resolveFinding } from "./resolve"
import { syncRulesFile } from "./rules-sync"

const ARCHETYPE: Archetype = {
  id: "archetype-checkout",
  projectId: PROJECT.id,
  label: "Checkout step",
  screenIds: ["screen-pricing"],
  createdAt: new Date("2026-08-01T00:00:00Z"),
}

/** The watched repo as the fake GitHub holds it, keyed by path. */
const REPO_FILES = Object.fromEntries(SOURCE_FILES.map((file) => [file.path, file.text]))

let repositories: FakeRepositories
let github: FakeGitHub
const held = process.env.GITHUB_REPO_ALLOWLIST

beforeEach(() => {
  process.env.GITHUB_REPO_ALLOWLIST = "acme/web"
  github = fakeGitHub(REPO_FILES)
  repositories = fakeRepositories({
    projects: [PROJECT],
    archetypes: [ARCHETYPE],
    conventions: [structuredClone(CTA_LABEL_CONVENTION)],
    findings: [structuredClone(TOKEN_FINDING), structuredClone(PATTERN_FINDING)],
    // Not a gs:// path, so the evidence images never reach Cloud Storage.
    screens: [screen({ screenshotPath: "no-screenshot-in-tests" })],
  })
})

afterEach(() => {
  if (held === undefined) delete process.env.GITHUB_REPO_ALLOWLIST
  else process.env.GITHUB_REPO_ALLOWLIST = held
})

function resolve(
  findingId: string,
  action: Parameters<typeof resolveFinding>[0]["action"],
  reason?: string,
) {
  return resolveFinding({ findingId, action, reason, repositories, octokit: github.octokit })
}

describe("resolveFinding, the record it leaves", () => {
  it("appends a resolution and moves the finding, in that order", async () => {
    const result = await resolve(PATTERN_FINDING.id, "conform")

    expect(repositories.stored.resolutions).toHaveLength(1)
    expect(repositories.stored.resolutions[0]).toMatchObject({
      projectId: PROJECT.id,
      findingId: PATTERN_FINDING.id,
      action: "resolved_conform",
    })
    expect(result.status).toBe("resolved_conform")
    expect(result.finding.resolvedAt).not.toBeNull()
  })

  it("appends rather than replaces when the same finding is resolved twice", async () => {
    await resolve(PATTERN_FINDING.id, "conform")
    await resolve(PATTERN_FINDING.id, "dismiss")

    expect(repositories.stored.resolutions).toHaveLength(2)
    expect(repositories.stored.resolutions.map((entry) => entry.action)).toEqual([
      "resolved_conform",
      "dismissed",
    ])
    expect(repositories.stored.findings[1]?.status).toBe("dismissed")
  })

  it("refuses a finding that is not there, before writing anything", async () => {
    await expect(resolve("nope", "dismiss")).rejects.toThrow(ResolutionNotFoundError)
    expect(repositories.stored.resolutions).toEqual([])
  })
})

describe("conform", () => {
  it("opens a pull request carrying the patch", async () => {
    const result = await resolve(PATTERN_FINDING.id, "conform")

    expect(result.pullRequest?.opened).toBe(true)
    expect(result.pullRequestError).toBeNull()
    expect(github.pulls).toHaveLength(1)
    expect(github.pulls[0]?.head).toBe(fixBranchName(PATTERN_FINDING.id))
    expect(github.branches.get(fixBranchName(PATTERN_FINDING.id))?.get("app/pricing/page.tsx")).toContain(
      ">Continue</button>",
    )
  })

  it("stores the pull request number on the finding", async () => {
    const result = await resolve(PATTERN_FINDING.id, "conform")

    expect(result.finding.prNumber).toBe(1)
    expect(repositories.stored.findings[1]?.prNumber).toBe(1)
  })

  it("puts the evidence sentence and the Drift line in the body", async () => {
    await resolve(PATTERN_FINDING.id, "conform")

    expect(github.pulls[0]?.body).toContain("This screen says Next. 4 sibling screens say Continue.")
    expect(github.pulls[0]?.body.trimEnd().endsWith("Opened by Drift.")).toBe(true)
  })

  it("substitutes the token value for a token finding", async () => {
    await resolve(TOKEN_FINDING.id, "conform")

    expect(github.branches.get(fixBranchName(TOKEN_FINDING.id))?.get("app/pricing/page.tsx")).toContain(
      `backgroundColor: "${NEAREST_TOKEN.value}"`,
    )
  })

  it("changes no convention, because the convention was right", async () => {
    await resolve(PATTERN_FINDING.id, "conform")

    expect(repositories.stored.conventions[0]?.value).toBe("Continue")
    expect(github.branches.has(RULES_BRANCH)).toBe(false)
  })
})

describe("update siblings", () => {
  it("moves the convention to this screen and promotes it", async () => {
    const result = await resolve(PATTERN_FINDING.id, "update_siblings")

    expect(repositories.stored.conventions[0]).toMatchObject({
      value: "Next",
      status: "promoted",
      confidence: "high",
      evidenceScreenIds: ["screen-pricing"],
    })
    expect(result.conventionChange).toContain("moved from Continue to Next")
  })

  it("patches the siblings rather than this screen", async () => {
    await resolve(PATTERN_FINDING.id, "update_siblings")

    const branch = github.branches.get(fixBranchName(PATTERN_FINDING.id))
    expect(branch?.get("app/checkout/step-2.tsx")).toContain(">Next</button>")
  })

  it("regenerates the rules file, because a convention changed", async () => {
    const result = await resolve(PATTERN_FINDING.id, "update_siblings")

    expect(result.rules?.changed).toBe(true)
    expect(result.rules?.prNumber).not.toBeNull()

    const rules = github.branches.get(RULES_BRANCH)?.get(RULES_PATH) ?? ""
    expect(rules).toContain(RULES_HEADER)
    expect(rules).toContain('- Label the last action on the screen "Next".')
    expect(rules).toContain("You chose this value.")
  })

  it("refuses on a token finding, which has no siblings to move", async () => {
    await expect(resolve(TOKEN_FINDING.id, "update_siblings")).rejects.toThrow(ResolutionError)
    expect(repositories.stored.resolutions).toEqual([])
  })
})

describe("accept as exception", () => {
  it("needs a reason, because it is respected permanently", async () => {
    await expect(resolve(PATTERN_FINDING.id, "exception")).rejects.toThrow(/needs a reason/)
    expect(repositories.stored.resolutions).toEqual([])
  })

  it("records the exception on the convention and leaves its value alone", async () => {
    await resolve(PATTERN_FINDING.id, "exception", "it is the marketing page")

    expect(repositories.stored.conventions[0]?.exceptions).toEqual([
      { screenId: "screen-pricing", reason: "it is the marketing page" },
    ])
    expect(repositories.stored.conventions[0]?.value).toBe("Continue")
  })

  it("writes the reason into the rules file", async () => {
    await resolve(PATTERN_FINDING.id, "exception", "it is the marketing page")

    const rules = github.branches.get(RULES_BRANCH)?.get(RULES_PATH) ?? ""
    expect(rules).toContain("### Recorded exceptions")
    expect(rules).toContain("/pricing is allowed to differ")
    expect(rules).toContain("Reason: it is the marketing page")
  })

  it("opens no pull request", async () => {
    await resolve(PATTERN_FINDING.id, "exception", "it is the marketing page")

    expect(github.pulls.map((pull) => pull.head)).toEqual([RULES_BRANCH])
  })

  it("works on a token finding, which has no convention to record it on", async () => {
    const result = await resolve(TOKEN_FINDING.id, "exception", "the error state is meant to shout")

    expect(result.status).toBe("resolved_exception")
    expect(result.conventionChange).toContain("the error state is meant to shout")
    expect(github.pulls).toEqual([])
  })
})

describe("dismiss", () => {
  it("changes the status and touches nothing else", async () => {
    const result = await resolve(TOKEN_FINDING.id, "dismiss")

    expect(result.status).toBe("dismissed")
    expect(result.pullRequest).toBeNull()
    expect(result.rules).toBeNull()
    expect(github.writes).toEqual([])
    expect(repositories.stored.conventions[0]?.value).toBe("Continue")
  })
})

describe("the allowlist, on every path that writes", () => {
  it("opens nothing against a repo that is not on it, whatever Firestore says", async () => {
    process.env.GITHUB_REPO_ALLOWLIST = "someone-else/web"

    const result = await resolve(PATTERN_FINDING.id, "conform")

    expect(result.pullRequestError).toMatch(/not on GITHUB_REPO_ALLOWLIST/)
    expect(github.writes).toEqual([])
    expect(github.pulls).toEqual([])
    // The decision is the person's and stands. Only the actuation was refused.
    expect(result.status).toBe("resolved_conform")
    expect(repositories.stored.resolutions).toHaveLength(1)
  })

  it("refuses the rules file too", async () => {
    process.env.GITHUB_REPO_ALLOWLIST = ""

    const result = await resolve(PATTERN_FINDING.id, "exception", "it is the marketing page")

    expect(result.rulesError).toMatch(/not on GITHUB_REPO_ALLOWLIST/)
    expect(github.branches.has(RULES_BRANCH)).toBe(false)
  })
})

describe("the rules file over time", () => {
  it("is proposed the first time and committed straight to the branch after", async () => {
    const first = await resolve(PATTERN_FINDING.id, "exception", "it is the marketing page")
    expect(first.rules?.firstTime).toBe(true)
    expect(first.rules?.prNumber).toBe(1)

    const second = await resolve(PATTERN_FINDING.id, "update_siblings")
    expect(second.rules?.firstTime).toBe(false)
    expect(second.rules?.prNumber).toBeNull()
    expect(github.pulls.filter((pull) => pull.head === RULES_BRANCH)).toHaveLength(1)
  })

  it("commits nothing when the file it would write is the one already there", async () => {
    const input = { octokit: github.octokit, project: PROJECT, repositories }
    await syncRulesFile(input)

    const again = await syncRulesFile(input)

    expect(again.changed).toBe(false)
    expect(github.writes.filter((write) => write === `commit ${RULES_BRANCH}`)).toHaveLength(1)
  })

  it("does not regenerate at all when an exception was already recorded", async () => {
    await resolve(PATTERN_FINDING.id, "exception", "it is the marketing page")
    const writes = [...github.writes]

    const again = await resolve(PATTERN_FINDING.id, "exception", "it is the marketing page")

    expect(again.conventionChange).toContain("It was already recorded.")
    expect(again.rules).toBeNull()
    expect(github.writes).toEqual(writes)
    expect(repositories.stored.conventions[0]?.exceptions).toHaveLength(1)
  })
})
