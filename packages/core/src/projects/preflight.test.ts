import { describe, expect, it } from "vitest"

import { fakeGitHub } from "../actuation/fake-github"
import { preflight, type CheckId, type PreflightCheck, type PreflightResult } from "./preflight"

const project = {
  name: "Woven",
  repo: "MRTHI-Tech/woven",
  previewUrl: "https://woven-preview.a.run.app",
  defaultBranch: "main",
  configPath: "drift.config.json",
}

const config = JSON.stringify({
  routes: ["/", "/pricing"],
  viewports: ["mobile"],
  tokenDefinitionsPath: "constants/theme.ts",
})

const theme = `export const theme = {
  colors: { brand: "#3355ff", ink: "#111111" },
  spacing: { sm: "8px", md: "16px" },
}`

/** A preview that answers every request with one status. */
function preview(status: number): typeof fetch {
  return (async () => new Response("", { status })) as unknown as typeof fetch
}

/** A preview that is not there at all. */
const unreachable = (async () => {
  throw new Error("getaddrinfo ENOTFOUND woven-preview.a.run.app")
}) as unknown as typeof fetch

function check(result: PreflightResult, id: CheckId): PreflightCheck {
  const found = result.checks.find((entry) => entry.id === id)
  if (!found) throw new Error(`No ${id} check in the result`)
  return found
}

describe("preflight", () => {
  it("passes every check on a repo that has everything", async () => {
    const { octokit } = fakeGitHub(
      { "drift.config.json": config, "constants/theme.ts": theme },
      "main",
      { fullName: "MRTHI-Tech/woven", private: false, push: true },
    )

    const result = await preflight({
      octokit,
      input: project,
      fetchImpl: preview(200),
      allowlist: ["MRTHI-Tech/woven"],
    })

    expect(result.checks.map((entry) => entry.status)).toEqual(["pass", "pass", "pass", "pass"])
    expect(result.ok).toBe(true)
  })

  it("takes the default branch from GitHub rather than from the input", async () => {
    const { octokit } = fakeGitHub({ "drift.config.json": config }, "main", {
      fullName: "MRTHI-Tech/woven",
      private: false,
      push: true,
    })

    const result = await preflight({ octokit, input: project, fetchImpl: preview(200) })

    expect(result.repo?.defaultBranch).toBe("main")
    expect(check(result, "repo").message).toContain("default branch is main")
  })

  it("fails, and stops, when the repo cannot be read", async () => {
    const { octokit } = fakeGitHub({}, "main", null)

    const result = await preflight({ octokit, input: project, fetchImpl: preview(200) })

    expect(result.ok).toBe(false)
    expect(check(result, "repo").status).toBe("fail")
    expect(check(result, "config").status).toBe("skipped")
    expect(check(result, "tokens").status).toBe("skipped")
  })

  it("says all three reasons a repo can be unreadable, because they look alike", async () => {
    const { octokit } = fakeGitHub({}, "main", null)

    const result = await preflight({ octokit, input: project, fetchImpl: preview(200) })

    expect(check(result, "repo").remedy).toContain("private")
    expect(check(result, "repo").remedy).toContain("GITHUB_TOKEN")
  })

  it("fails when there is no config, and says Drift can write one", async () => {
    const { octokit } = fakeGitHub({}, "main", {
      fullName: "MRTHI-Tech/woven",
      private: false,
      push: true,
    })

    const result = await preflight({ octokit, input: project, fetchImpl: preview(200) })

    expect(result.ok).toBe(false)
    expect(result.configMissing).toBe(true)
    expect(check(result, "config").remedy).toContain("Drift can write one")
  })

  it("fails on a config that is there and invalid, and offers to change nothing", async () => {
    const { octokit } = fakeGitHub(
      { "drift.config.json": JSON.stringify({ routes: ["/"], viewport: ["mobile"] }) },
      "main",
      { fullName: "MRTHI-Tech/woven", private: false, push: true },
    )

    const result = await preflight({ octokit, input: project, fetchImpl: preview(200) })

    expect(result.ok).toBe(false)
    // Not missing: a config that exists is a file a person owns (section 10b).
    expect(result.configMissing).toBe(false)
    expect(check(result, "config").remedy).toContain("does not edit a config that is already there")
  })

  it("catches a misspelled key rather than ignoring it, because the schema is strict", async () => {
    const { octokit } = fakeGitHub(
      { "drift.config.json": JSON.stringify({ routes: ["/"], viewport: ["mobile"] }) },
      "main",
      { fullName: "MRTHI-Tech/woven", private: false, push: true },
    )

    const result = await preflight({ octokit, input: project, fetchImpl: preview(200) })

    expect(check(result, "config").message).toContain("viewport")
  })

  it("counts what the config declares back to the person", async () => {
    const { octokit } = fakeGitHub({ "drift.config.json": config }, "main", {
      fullName: "MRTHI-Tech/woven",
      private: false,
      push: true,
    })

    const result = await preflight({ octokit, input: project, fetchImpl: preview(200) })

    expect(check(result, "config").message).toBe("2 routes at mobile.")
  })

  it("asks the preview for a route the config declares, not just its root", async () => {
    const { octokit } = fakeGitHub({ "drift.config.json": config }, "main", {
      fullName: "MRTHI-Tech/woven",
      private: false,
      push: true,
    })

    const asked: string[] = []
    const recording = (async (url: string) => {
      asked.push(String(url))
      return new Response("", { status: 200 })
    }) as unknown as typeof fetch

    await preflight({ octokit, input: project, fetchImpl: recording })

    expect(asked).toEqual(["https://woven-preview.a.run.app/"])
  })

  it("warns rather than fails when the preview does not answer", async () => {
    const { octokit } = fakeGitHub({ "drift.config.json": config }, "main", {
      fullName: "MRTHI-Tech/woven",
      private: false,
      push: true,
    })

    const result = await preflight({ octokit, input: project, fetchImpl: unreachable })

    expect(check(result, "preview").status).toBe("warn")
    expect(result.ok).toBe(true)
  })

  it("warns when the preview answers, but not for the route the config names", async () => {
    const { octokit } = fakeGitHub({ "drift.config.json": config }, "main", {
      fullName: "MRTHI-Tech/woven",
      private: false,
      push: true,
    })

    const result = await preflight({ octokit, input: project, fetchImpl: preview(404) })

    expect(check(result, "preview").status).toBe("warn")
    expect(check(result, "preview").remedy).toContain("points at the deployment that repo builds")
  })

  it("warns when the token path is stale, because a run still renders without it", async () => {
    const { octokit } = fakeGitHub({ "drift.config.json": config }, "main", {
      fullName: "MRTHI-Tech/woven",
      private: false,
      push: true,
    })

    const result = await preflight({ octokit, input: project, fetchImpl: preview(200) })

    expect(check(result, "tokens").status).toBe("warn")
    expect(result.ok).toBe(true)
  })

  it("counts the scales a token file declares", async () => {
    const { octokit } = fakeGitHub(
      { "drift.config.json": config, "constants/theme.ts": theme },
      "main",
      { fullName: "MRTHI-Tech/woven", private: false, push: true },
    )

    const result = await preflight({ octokit, input: project, fetchImpl: preview(200) })

    expect(check(result, "tokens").message).toBe("constants/theme.ts declares 2 colours, 2 spacing steps.")
  })

  it("warns when the config declares no token path at all", async () => {
    const { octokit } = fakeGitHub(
      { "drift.config.json": JSON.stringify({ routes: ["/"] }) },
      "main",
      { fullName: "MRTHI-Tech/woven", private: false, push: true },
    )

    const result = await preflight({ octokit, input: project, fetchImpl: preview(200) })

    expect(check(result, "tokens").status).toBe("warn")
    expect(check(result, "tokens").remedy).toContain("no token drift")
  })

  it("reports a repo that is not on the allowlist without failing it", async () => {
    const { octokit } = fakeGitHub({ "drift.config.json": config }, "main", {
      fullName: "MRTHI-Tech/woven",
      private: false,
      push: true,
    })

    const result = await preflight({
      octokit,
      input: project,
      fetchImpl: preview(200),
      allowlist: ["someone/else"],
    })

    expect(result.advisories.allowlisted).toBe(false)
    expect(result.ok).toBe(true)
  })

  it("reports the auth cookie a config asks for, and whether the value is set", async () => {
    const { octokit } = fakeGitHub(
      {
        "drift.config.json": JSON.stringify({ routes: ["/"], authCookieName: "__session" }),
      },
      "main",
      { fullName: "MRTHI-Tech/woven", private: false, push: true },
    )

    const result = await preflight({
      octokit,
      input: project,
      fetchImpl: preview(200),
      previewAuthCookieValue: "",
    })

    expect(result.advisories.authCookie).toEqual({ name: "__session", valueSet: false })
  })

  it("says nothing about a cookie when the config asks for none", async () => {
    const { octokit } = fakeGitHub({ "drift.config.json": config }, "main", {
      fullName: "MRTHI-Tech/woven",
      private: false,
      push: true,
    })

    const result = await preflight({ octokit, input: project, fetchImpl: preview(200) })

    expect(result.advisories.authCookie).toBeNull()
  })
})
