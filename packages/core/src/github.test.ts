import type { Octokit } from "@octokit/rest"
import { afterEach, describe, expect, it } from "vitest"

import { DriftConfigError } from "./config"
import {
  GitHubError,
  RepoNotAllowedError,
  assertRepoAllowed,
  createAppClient,
  createGitHubClient,
  createInstallationClient,
  decodePrivateKey,
  fetchDriftConfig,
  fetchRepoFile,
  githubAppConfig,
  githubAuthMode,
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
 * A PEM shaped like the one GitHub issues. Not a usable key and never used as
 * one: every test here stops before a request is signed.
 */
const PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj3\n-----END RSA PRIVATE KEY-----"

describe("decodePrivateKey", () => {
  it("passes a PEM through unchanged", () => {
    expect(decodePrivateKey(PEM)).toBe(PEM)
  })

  it("decodes the same bytes from base64, which is what fits in a .env file", () => {
    expect(decodePrivateKey(Buffer.from(PEM, "utf8").toString("base64"))).toBe(PEM)
  })

  it("restores the newlines a shell escaped on the way in", () => {
    expect(decodePrivateKey(PEM.replace(/\n/g, "\\n"))).toBe(PEM)
  })

  it("refuses anything that is neither", () => {
    expect(() => decodePrivateKey("not a key")).toThrow(/GITHUB_APP_PRIVATE_KEY/)
  })
})

describe("githubAppConfig", () => {
  it("is null when neither variable is set, because that is the fallback state", () => {
    expect(githubAppConfig({})).toBeNull()
  })

  it("is null when only one of the two is set", () => {
    expect(githubAppConfig({ GITHUB_APP_ID: "1" })).toBeNull()
    expect(githubAppConfig({ GITHUB_APP_PRIVATE_KEY: PEM })).toBeNull()
  })

  it("reads both and decodes the key", () => {
    const config = githubAppConfig({
      GITHUB_APP_ID: " 1234 ",
      GITHUB_APP_PRIVATE_KEY: Buffer.from(PEM, "utf8").toString("base64"),
    })
    expect(config).toEqual({ appId: "1234", privateKey: PEM })
  })
})

describe("the app clients", () => {
  it("refuse to run with no app configured", () => {
    expect(() => createAppClient(null)).toThrow(/GITHUB_APP_ID/)
    expect(() => createInstallationClient(42, null)).toThrow(/GITHUB_APP_ID/)
  })

  it("build a client when one is", () => {
    const config = { appId: "1234", privateKey: PEM }
    expect(createAppClient(config)).toBeDefined()
    expect(createInstallationClient(42, config)).toBeDefined()
  })
})

/**
 * Which credential a project gets. The fallback is the whole point of this
 * pair: a project with no installation, or a deployment with no app, keeps
 * working on the token it already had.
 */
describe("githubAuthMode", () => {
  const config = { appId: "1234", privateKey: PEM }

  it("uses the app when the project has an installation and the app exists", () => {
    expect(githubAuthMode(42, config)).toBe("app")
  })

  it("falls back to the token when the project has no installation", () => {
    expect(githubAuthMode(null, config)).toBe("token")
  })

  it("falls back to the token when the app is not configured", () => {
    expect(githubAuthMode(42, null)).toBe("token")
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
