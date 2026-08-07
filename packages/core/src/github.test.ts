import type { Octokit } from "@octokit/rest"
import { afterEach, describe, expect, it } from "vitest"

import { DriftConfigError } from "./config"
import {
  GitHubError,
  RepoNotAllowedError,
  assertRepoAllowed,
  createGitHubClient,
  fetchDriftConfig,
  fetchRepoFile,
  isRepoAllowed,
  isSourcePath,
  parseRepo,
  rawFileUrl,
  repoAllowlist,
} from "./github"

const source = { repo: "acme/web", configPath: "drift.config.json", defaultBranch: "main" }

/** An Octokit whose only job is to answer one getContent call. */
function fakeOctokit(answer: unknown | (() => never)): Octokit {
  return {
    rest: {
      repos: {
        getContent: async () => {
          if (typeof answer === "function") answer()
          return { data: answer }
        },
      },
    },
  } as unknown as Octokit
}

function fileAnswer(content: string): unknown {
  return {
    type: "file",
    encoding: "base64",
    content: Buffer.from(content, "utf8").toString("base64"),
  }
}

function notFound(): never {
  throw Object.assign(new Error("Not Found"), { status: 404 })
}

describe("parseRepo", () => {
  it("splits owner and name", () => {
    expect(parseRepo("acme/web")).toEqual({ owner: "acme", repo: "web" })
  })

  it("rejects anything that is not owner/name", () => {
    expect(() => parseRepo("acme")).toThrow(GitHubError)
    expect(() => parseRepo("acme/web/extra")).toThrow(GitHubError)
    expect(() => parseRepo("/web")).toThrow(GitHubError)
  })
})

describe("createGitHubClient", () => {
  it("refuses to run without a token", () => {
    expect(() => createGitHubClient(undefined)).toThrow(/GITHUB_TOKEN/)
  })
})

/**
 * The hard gate of AGENTS.md section 8. These are the tests that matter most in
 * this file: everything else here costs a run its data, and this costs somebody
 * a pull request on a repository that is not theirs to open one on.
 */
describe("the repo allowlist", () => {
  const held = process.env.GITHUB_REPO_ALLOWLIST

  afterEach(() => {
    if (held === undefined) delete process.env.GITHUB_REPO_ALLOWLIST
    else process.env.GITHUB_REPO_ALLOWLIST = held
  })

  it("reads a comma-separated list, ignoring the spaces around it", () => {
    expect(repoAllowlist(" acme/web , acme/docs ")).toEqual(["acme/web", "acme/docs"])
  })

  it("treats an unset variable as no repo, not as every repo", () => {
    expect(repoAllowlist(undefined)).toEqual([])
    expect(isRepoAllowed("acme/web", repoAllowlist(undefined))).toBe(false)
    expect(() => assertRepoAllowed("acme/web", [])).toThrow(RepoNotAllowedError)
  })

  it("allows a repo on the list, whatever its case", () => {
    expect(isRepoAllowed("Acme/Web", ["acme/web"])).toBe(true)
    expect(() => assertRepoAllowed("acme/WEB", ["Acme/Web"])).not.toThrow()
  })

  it("refuses one that is not, and says what is", () => {
    expect(() => assertRepoAllowed("stranger/web", ["acme/web"])).toThrow(
      /stranger\/web is not on GITHUB_REPO_ALLOWLIST, which allows acme\/web/,
    )
  })

  it("refuses a repo that merely looks like one on the list", () => {
    expect(isRepoAllowed("acme/web-staging", ["acme/web"])).toBe(false)
    expect(isRepoAllowed("notacme/web", ["acme/web"])).toBe(false)
    expect(isRepoAllowed("acme/web ", ["acme/webhooks"])).toBe(false)
  })

  it("reads the environment when no list is passed", () => {
    process.env.GITHUB_REPO_ALLOWLIST = "acme/web"

    expect(isRepoAllowed("acme/web")).toBe(true)
    expect(isRepoAllowed("stranger/web")).toBe(false)
  })
})

describe("isSourcePath", () => {
  it("takes the files a label or a value is written in", () => {
    expect(isSourcePath("app/pricing/page.tsx")).toBe(true)
    expect(isSourcePath("styles/globals.css")).toBe(true)
    expect(isSourcePath("theme.ts")).toBe(true)
  })

  it("leaves build output and dependencies alone", () => {
    expect(isSourcePath("node_modules/react/index.js")).toBe(false)
    expect(isSourcePath(".next/static/chunk.js")).toBe(false)
    expect(isSourcePath("dist/app.js")).toBe(false)
    expect(isSourcePath(".drift/evidence/finding1/before.png")).toBe(false)
  })

  it("leaves anything that is not source alone", () => {
    expect(isSourcePath("README.md")).toBe(false)
    expect(isSourcePath("public/logo.png")).toBe(false)
    expect(isSourcePath("Dockerfile")).toBe(false)
  })
})

describe("rawFileUrl", () => {
  it("spells a branch carrying a slash so it cannot be read as a path", () => {
    expect(rawFileUrl("acme/web", "drift/evidence", ".drift/evidence/f1/before.png")).toBe(
      "https://raw.githubusercontent.com/acme/web/refs/heads/drift/evidence/" +
        ".drift/evidence/f1/before.png",
    )
  })
})

describe("fetchRepoFile", () => {
  it("decodes the file", async () => {
    const text = await fetchRepoFile(fakeOctokit(fileAnswer("hello")), {
      repo: "acme/web",
      path: "a.txt",
      ref: "main",
    })

    expect(text).toBe("hello")
  })

  it("returns null for a file that is not there", async () => {
    const text = await fetchRepoFile(fakeOctokit(notFound), {
      repo: "acme/web",
      path: "a.txt",
      ref: "main",
    })

    expect(text).toBeNull()
  })

  it("refuses a directory", async () => {
    await expect(
      fetchRepoFile(fakeOctokit([]), { repo: "acme/web", path: "src", ref: "main" }),
    ).rejects.toThrow(/directory/)
  })

  it("refuses a file too large to come back inline", async () => {
    await expect(
      fetchRepoFile(fakeOctokit({ type: "file", encoding: "none", content: "" }), {
        repo: "acme/web",
        path: "big.json",
        ref: "main",
      }),
    ).rejects.toThrow(/too large/)
  })
})

describe("fetchDriftConfig", () => {
  it("parses a config off the default branch and applies its defaults", async () => {
    const octokit = fakeOctokit(fileAnswer(JSON.stringify({ routes: ["/", "/pricing"] })))

    const config = await fetchDriftConfig(octokit, source)

    expect(config).toEqual({
      routes: ["/", "/pricing"],
      viewports: ["mobile", "desktop"],
      authCookieName: null,
      seedData: false,
      tokenDefinitionsPath: null,
    })
  })

  it("says which repo is missing a config", async () => {
    await expect(fetchDriftConfig(fakeOctokit(notFound), source)).rejects.toThrow(
      "acme/web has no drift.config.json on main.",
    )
  })

  it("rejects a config that is not JSON", async () => {
    await expect(fetchDriftConfig(fakeOctokit(fileAnswer("{oops")), source)).rejects.toThrow(
      DriftConfigError,
    )
  })

  it("rejects an unknown key rather than ignoring a typo", async () => {
    const octokit = fakeOctokit(fileAnswer(JSON.stringify({ routes: ["/"], viewport: ["mobile"] })))

    await expect(fetchDriftConfig(octokit, source)).rejects.toThrow(/viewport/)
  })

  it("rejects a route that is not an absolute path", async () => {
    const octokit = fakeOctokit(fileAnswer(JSON.stringify({ routes: ["pricing"] })))

    await expect(fetchDriftConfig(octokit, source)).rejects.toThrow(/must start with/)
  })
})
