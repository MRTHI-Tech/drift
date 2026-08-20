/**
 * What `ensureBranch` does when GitHub accepts a ref and then cannot find it.
 *
 * This is not hypothetical and it is not something the in-memory fake can
 * show, because the fake is consistent with itself by construction. It came
 * from opening a real pull request on a real repository: `createRef` returned
 * a sha, `commitFiles` read the ref back a moment later and got a 404, and the
 * branch was sitting there when anybody looked afterwards.
 */

import type { Octokit } from "@octokit/rest"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { REF_VISIBILITY_ATTEMPTS, ensureBranch, setRefVisibilitySleep } from "./github"

const held = process.env.GITHUB_REPO_ALLOWLIST
let restoreSleep: (ms: number) => Promise<void>
const waits: number[] = []

beforeEach(() => {
  process.env.GITHUB_REPO_ALLOWLIST = "acme/web"
  waits.length = 0
  restoreSleep = setRefVisibilitySleep(async (ms) => {
    waits.push(ms)
  })
})

afterEach(() => {
  if (held === undefined) delete process.env.GITHUB_REPO_ALLOWLIST
  else process.env.GITHUB_REPO_ALLOWLIST = held
  setRefVisibilitySleep(restoreSleep)
})

const notFound = () => Object.assign(new Error("Not Found"), { status: 404 })

/**
 * A GitHub whose new refs take `lag` reads to become visible. `main` is always
 * there; the branch being created is not, until it is.
 */
function laggyGitHub(lag: number, branch = "drift/fix-1") {
  let created = false
  let reads = 0
  const creates: string[] = []

  const octokit = {
    rest: {
      git: {
        async getRef({ ref }: { ref: string }) {
          if (ref === "heads/main") return { data: { object: { sha: "base-sha" } } }
          if (ref !== `heads/${branch}`) throw notFound()
          if (!created) throw notFound()
          reads += 1
          if (reads <= lag) throw notFound()
          return { data: { object: { sha: "new-sha" } } }
        },
        async createRef({ ref }: { ref: string }) {
          creates.push(ref)
          created = true
          return { data: { object: { sha: "new-sha" } } }
        },
      },
    },
  } as unknown as Octokit

  return { octokit, creates }
}

describe("ensureBranch, when a new ref is not readable yet", () => {
  it("waits for the ref it just created rather than handing back a name that 404s", async () => {
    const { octokit, creates } = laggyGitHub(2)

    const result = await ensureBranch(octokit, {
      repo: "acme/web",
      branch: "drift/fix-1",
      fromRef: "main",
    })

    expect(result).toEqual({ sha: "new-sha", created: true })
    expect(creates).toEqual(["refs/heads/drift/fix-1"])
    expect(waits.length).toBeGreaterThan(0)
  })

  it("creates the ref exactly once, however many reads it takes", async () => {
    const { octokit, creates } = laggyGitHub(3)

    await ensureBranch(octokit, { repo: "acme/web", branch: "drift/fix-1", fromRef: "main" })

    expect(creates).toHaveLength(1)
  })

  it("does not wait at all when the ref is visible immediately", async () => {
    const { octokit } = laggyGitHub(0)

    await ensureBranch(octokit, { repo: "acme/web", branch: "drift/fix-1", fromRef: "main" })

    expect(waits).toEqual([])
  })

  it("says what happened when the ref never appears", async () => {
    const { octokit } = laggyGitHub(REF_VISIBILITY_ATTEMPTS + 5)

    await expect(
      ensureBranch(octokit, { repo: "acme/web", branch: "drift/fix-1", fromRef: "main" }),
    ).rejects.toThrow(/created and is still not readable/)
  })

  it("backs off further with each attempt", async () => {
    const { octokit } = laggyGitHub(3)

    await ensureBranch(octokit, { repo: "acme/web", branch: "drift/fix-1", fromRef: "main" })

    expect(waits).toEqual([...waits].sort((a, b) => a - b))
    expect(new Set(waits).size).toBe(waits.length)
  })
})
