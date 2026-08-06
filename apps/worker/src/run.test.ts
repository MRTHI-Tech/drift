import type { Project, Repositories, Run } from "@drift/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createLogger } from "./logger"
import { captureAll, describeFailures, runProject, summarizeRun, type TargetFailure } from "./run"
import { buildTargets, type RenderTarget } from "./targets"

const silent = createLogger({}, () => {})

const project: Project = {
  id: "proj1",
  name: "Acme",
  repo: "acme/web",
  previewUrl: "https://preview.example.com",
  defaultBranch: "main",
  configPath: "drift.config.json",
  createdAt: new Date("2026-08-01T00:00:00Z"),
  driftScore: 0,
  lastRunAt: null,
}

describe("captureAll", () => {
  it("renders every target in order", async () => {
    const targets = buildTargets({ routes: ["/", "/pricing"], viewports: ["mobile"] })
    const seen: string[] = []

    const failures = await captureAll(
      targets,
      async (target) => {
        seen.push(target.route)
      },
      silent,
    )

    expect(seen).toEqual(["/", "/pricing"])
    expect(failures).toEqual([])
  })

  it("records a failed target and keeps going", async () => {
    const targets = buildTargets({ routes: ["/a", "/b", "/c"], viewports: ["mobile"] })
    const rendered: string[] = []

    const failures = await captureAll(
      targets,
      async (target) => {
        if (target.route === "/b") throw new Error("HTTP 500")
        rendered.push(target.route)
      },
      silent,
    )

    expect(rendered).toEqual(["/a", "/c"])
    expect(failures).toEqual([
      { target: { route: "/b", viewport: "mobile" }, message: "HTTP 500" },
    ])
  })

  it("survives every target failing", async () => {
    const targets = buildTargets({ routes: ["/a", "/b"], viewports: ["mobile"] })

    const failures = await captureAll(
      targets,
      async () => {
        throw new Error("net::ERR_CONNECTION_REFUSED")
      },
      silent,
    )

    expect(failures).toHaveLength(2)
  })
})

describe("summarizeRun", () => {
  const targets = buildTargets({ routes: ["/a", "/b"], viewports: ["mobile", "desktop"] })

  it("is clean when every target rendered", () => {
    expect(summarizeRun(targets, [])).toEqual({ status: "clean", routesChecked: 2, error: null })
  })

  it("is an error when a target failed, and counts only whole routes", () => {
    const failures: TargetFailure[] = [
      { target: { route: "/b", viewport: "desktop" }, message: "HTTP 500" },
    ]

    const outcome = summarizeRun(targets, failures)

    expect(outcome.status).toBe("error")
    expect(outcome.routesChecked).toBe(1)
    expect(outcome.error).toContain("/b (desktop): HTTP 500")
  })

  it("checks no routes when everything failed", () => {
    const failures: TargetFailure[] = targets.map((target: RenderTarget) => ({
      target,
      message: "boom",
    }))

    expect(summarizeRun(targets, failures)).toMatchObject({ status: "error", routesChecked: 0 })
  })
})

describe("describeFailures", () => {
  it("leads with the count so the document reads at a glance", () => {
    const message = describeFailures(4, [
      { target: { route: "/a", viewport: "mobile" }, message: "HTTP 500" },
    ])

    expect(message).toBe("1 of 4 targets failed. /a (mobile): HTTP 500")
  })

  it("stays short enough to store", () => {
    const failures = Array.from({ length: 40 }, () => ({
      target: { route: "/a", viewport: "mobile" as const },
      message: "x".repeat(80),
    }))

    expect(describeFailures(40, failures).length).toBeLessThanOrEqual(1000)
  })
})

describe("runProject", () => {
  const originalToken = process.env.GITHUB_TOKEN

  beforeEach(() => {
    delete process.env.GITHUB_TOKEN
  })

  afterEach(() => {
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN
    else process.env.GITHUB_TOKEN = originalToken
  })

  function fakeRepositories(found: Project | null): {
    repositories: Repositories
    created: Omit<Run, "id">[]
    updated: Partial<Run>[]
  } {
    const created: Omit<Run, "id">[] = []
    const updated: Partial<Run>[] = []

    const repositories = {
      projects: {
        get: async () => found,
        update: async () => found,
      },
      runs: {
        create: async (input: Omit<Run, "id">) => {
          created.push(input)
          return { ...input, id: "run1" }
        },
        update: async (_id: string, patch: Partial<Run>) => {
          updated.push(patch)
          return patch
        },
      },
    } as unknown as Repositories

    return { repositories, created, updated }
  }

  it("writes the runs document even when the run fails outright", async () => {
    const { repositories, created, updated } = fakeRepositories(project)

    await expect(
      runProject({ projectId: project.id, repositories, logger: silent }),
    ).rejects.toThrow(/GITHUB_TOKEN/)

    // Created up front as an error, so a killed process leaves an honest run.
    expect(created[0]).toMatchObject({
      projectId: "proj1",
      trigger: "manual",
      status: "error",
      routesChecked: 0,
      findingIds: [],
    })
    expect(created[0]?.finishedAt).toBeNull()

    expect(updated[0]).toMatchObject({ status: "error" })
    expect(updated[0]?.error).toMatch(/GITHUB_TOKEN/)
    expect(updated[0]?.finishedAt).toBeInstanceOf(Date)
  })

  it("writes nothing for a project that does not exist", async () => {
    const { repositories, created } = fakeRepositories(null)

    await expect(
      runProject({ projectId: "missing", repositories, logger: silent }),
    ).rejects.toThrow(/no project missing/)

    expect(created).toEqual([])
  })

  it("creates no run while dry running", async () => {
    const { repositories, created } = fakeRepositories(project)

    await expect(
      runProject({ projectId: project.id, repositories, logger: silent, dryRun: true }),
    ).rejects.toThrow(/GITHUB_TOKEN/)

    expect(created).toEqual([])
  })
})
