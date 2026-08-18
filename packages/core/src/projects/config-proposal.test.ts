import { beforeEach, describe, expect, it } from "vitest"

import { fakeGitHub } from "../actuation/fake-github"
import { parseDriftConfig } from "../config"
import { RepoNotAllowedError } from "../github"
import { CONFIG_BRANCH, composeConfigProposal, openConfigPullRequest } from "./config-proposal"

const project = {
  name: "Woven",
  repo: "MRTHI-Tech/woven",
  previewUrl: "https://woven-preview.a.run.app",
  defaultBranch: "main",
  configPath: "drift.config.json",
  installationId: null,
}

const theme = `export const theme = {
  colors: { brand: "#3355ff" },
  spacing: { md: "16px" },
}`

beforeEach(() => {
  process.env.GITHUB_REPO_ALLOWLIST = "MRTHI-Tech/woven"
})

describe("composeConfigProposal", () => {
  it("composes a config the schema accepts", async () => {
    const { octokit } = fakeGitHub({})

    const proposal = await composeConfigProposal({ octokit, project })

    expect(() => parseDriftConfig(JSON.parse(proposal.content))).not.toThrow()
  })

  it("declares only the root route, because Drift never guesses routes", async () => {
    const { octokit } = fakeGitHub({})

    const proposal = await composeConfigProposal({ octokit, project })

    expect(JSON.parse(proposal.content).routes).toEqual(["/"])
  })

  it("fills in a token path that is there and parses", async () => {
    const { octokit } = fakeGitHub({ "constants/theme.ts": theme })

    const proposal = await composeConfigProposal({ octokit, project })

    expect(proposal.tokenDefinitionsPath).toBe("constants/theme.ts")
    expect(JSON.parse(proposal.content).tokenDefinitionsPath).toBe("constants/theme.ts")
  })

  it("leaves the token path out when no candidate holds tokens", async () => {
    const { octokit } = fakeGitHub({ "constants/theme.ts": "export const nothing = 1" })

    const proposal = await composeConfigProposal({ octokit, project })

    expect(proposal.tokenDefinitionsPath).toBeNull()
    expect(JSON.parse(proposal.content)).not.toHaveProperty("tokenDefinitionsPath")
  })

  it("writes nothing, so it is safe for a repo Drift may not write to", async () => {
    const { octokit, writes } = fakeGitHub({ "constants/theme.ts": theme })

    await composeConfigProposal({ octokit, project })

    expect(writes).toEqual([])
  })

  it("ends the file with a newline", async () => {
    const { octokit } = fakeGitHub({})

    const proposal = await composeConfigProposal({ octokit, project })

    expect(proposal.content.endsWith("}\n")).toBe(true)
  })
})

describe("openConfigPullRequest", () => {
  it("puts the config on drift/config and proposes it", async () => {
    const github = fakeGitHub({})
    const proposal = await composeConfigProposal({ octokit: github.octokit, project })

    const result = await openConfigPullRequest({ octokit: github.octokit, project, proposal })

    expect(result.branch).toBe(CONFIG_BRANCH)
    expect(github.branches.get(CONFIG_BRANCH)?.get("drift.config.json")).toBe(proposal.content)
    expect(github.pulls).toHaveLength(1)
  })

  it("proposes it against the default branch", async () => {
    const github = fakeGitHub({})
    const proposal = await composeConfigProposal({ octokit: github.octokit, project })

    await openConfigPullRequest({ octokit: github.octokit, project, proposal })

    expect(github.pulls[0]).toMatchObject({ head: CONFIG_BRANCH, base: "main" })
  })

  it("ends the body with the line every Drift pull request ends with", async () => {
    const github = fakeGitHub({})
    const proposal = await composeConfigProposal({ octokit: github.octokit, project })

    await openConfigPullRequest({ octokit: github.octokit, project, proposal })

    expect(github.pulls[0]?.body.endsWith("Opened by Drift.")).toBe(true)
  })

  it("asks for the routes, because the proposal only declares the root", async () => {
    const github = fakeGitHub({})
    const proposal = await composeConfigProposal({ octokit: github.octokit, project })

    await openConfigPullRequest({ octokit: github.octokit, project, proposal })

    expect(github.pulls[0]?.body).toContain("Add the routes you want watched")
  })

  it("refuses a repo that is not on the allowlist, before any network call", async () => {
    process.env.GITHUB_REPO_ALLOWLIST = "someone/else"
    const github = fakeGitHub({})
    const proposal = await composeConfigProposal({ octokit: github.octokit, project })

    await expect(
      openConfigPullRequest({ octokit: github.octokit, project, proposal }),
    ).rejects.toBeInstanceOf(RepoNotAllowedError)
    expect(github.writes).toEqual([])
  })

  it("refuses to overwrite a config that appeared in the meantime", async () => {
    const github = fakeGitHub({})
    const proposal = await composeConfigProposal({ octokit: github.octokit, project })

    // Somebody committed one between the inspection and the proposal.
    github.branches.get("main")?.set("drift.config.json", '{"routes":["/"]}')

    await expect(
      openConfigPullRequest({ octokit: github.octokit, project, proposal }),
    ).rejects.toThrow("does not overwrite a config that is there")
    expect(github.writes).toEqual([])
  })

  it("does not stack a second pull request when asked twice", async () => {
    const github = fakeGitHub({})
    const proposal = await composeConfigProposal({ octokit: github.octokit, project })

    await openConfigPullRequest({ octokit: github.octokit, project, proposal })
    const second = await openConfigPullRequest({ octokit: github.octokit, project, proposal })

    expect(github.pulls).toHaveLength(1)
    expect(second.created).toBe(false)
  })
})
