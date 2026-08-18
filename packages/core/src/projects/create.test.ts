import { describe, expect, it } from "vitest"

import { fakeRepositories } from "../actuation/fake-repositories"
import { createLogger } from "../logging"
import type { Project } from "../types"
import { createProject, ProjectExistsError, ProjectInputError } from "./create"

const input = {
  userId: "user1",  name: "Woven",
  repo: "MRTHI-Tech/woven",
  previewUrl: "https://woven-preview.a.run.app",
}

function existingProject(repo: string): Project {
  return {
    id: "project-existing",
    userId: "user1",    name: "Woven",
    repo,
    previewUrl: "https://woven-preview.a.run.app",
    defaultBranch: "main",
    configPath: "drift.config.json",
    installationId: null,
    createdAt: new Date("2026-01-01"),
    driftScore: 12,
    lastRunAt: null,
  }
}

/** A logger that keeps its lines instead of writing them. */
function recordingLogger() {
  const lines: string[] = []
  return { logger: createLogger({}, (line) => lines.push(line)), lines }
}

describe("createProject", () => {
  it("writes one project with the defaults filled in", async () => {
    const repositories = fakeRepositories()

    const project = await createProject({ input, repositories })

    expect(project).toMatchObject({
      userId: "user1",      name: "Woven",
      repo: "MRTHI-Tech/woven",
      previewUrl: "https://woven-preview.a.run.app",
      defaultBranch: "main",
      configPath: "drift.config.json",
      installationId: null,
    })
    expect(repositories.stored.projects).toHaveLength(1)
  })

  it("starts a project at nothing checked rather than at a guess", async () => {
    const repositories = fakeRepositories()

    const project = await createProject({ input, repositories })

    expect(project.driftScore).toBe(0)
    expect(project.lastRunAt).toBeNull()
  })

  it("writes no run, no screen and no finding", async () => {
    const repositories = fakeRepositories()

    await createProject({ input, repositories })

    expect(repositories.stored.screens).toHaveLength(0)
    expect(repositories.stored.findings).toHaveLength(0)
    expect(repositories.stored.resolutions).toHaveLength(0)
  })

  it("refuses a second project on a repo that is already watched", async () => {
    const repositories = fakeRepositories({ projects: [existingProject("MRTHI-Tech/woven")] })

    await expect(createProject({ input, repositories })).rejects.toBeInstanceOf(ProjectExistsError)
    expect(repositories.stored.projects).toHaveLength(1)
  })

  it("names the project that already watches the repo", async () => {
    const repositories = fakeRepositories({ projects: [existingProject("MRTHI-Tech/woven")] })

    await expect(createProject({ input, repositories })).rejects.toThrow(
      "MRTHI-Tech/woven is already watched, by Woven.",
    )
  })

  it("compares against the normalised repo, so a pasted URL is still a duplicate", async () => {
    const repositories = fakeRepositories({ projects: [existingProject("MRTHI-Tech/woven")] })

    await expect(
      createProject({
        input: { ...input, repo: "https://github.com/MRTHI-Tech/woven" },
        repositories,
      }),
    ).rejects.toBeInstanceOf(ProjectExistsError)
  })

  it("writes nothing when what was typed is not usable", async () => {
    const repositories = fakeRepositories()

    await expect(
      createProject({ input: { ...input, previewUrl: "not a url" }, repositories }),
    ).rejects.toBeInstanceOf(ProjectInputError)
    expect(repositories.stored.projects).toHaveLength(0)
  })

  it("carries one issue per bad field on the error", async () => {
    const repositories = fakeRepositories()

    await createProject({ input: { userId: "user1", name: "", repo: "x", previewUrl: "" }, repositories }).catch(
      (error: unknown) => {
        expect(error).toBeInstanceOf(ProjectInputError)
        expect((error as ProjectInputError).issues.map((issue) => issue.field)).toEqual([
          "repo",
          "name",
          "previewUrl",
        ])
      },
    )
  })

  it("logs the project it created", async () => {
    const repositories = fakeRepositories()
    const { logger, lines } = recordingLogger()

    const project = await createProject({ input, repositories, logger })

    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      phase: "project.created",
      projectId: project.id,
      repo: "MRTHI-Tech/woven",
    })
  })
})
