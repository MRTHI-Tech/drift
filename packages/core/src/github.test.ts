import type { Octokit } from "@octokit/rest"
import { describe, expect, it } from "vitest"

import { DriftConfigError } from "./config"
import { GitHubError, createGitHubClient, fetchDriftConfig, fetchRepoFile, parseRepo } from "./github"

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
