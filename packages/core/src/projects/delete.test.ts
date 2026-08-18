import { describe, expect, it } from "vitest"

import { fakeRepositories } from "../actuation/fake-repositories"
import { createLogger } from "../logging"
import type { Project } from "../types"
import {
  confirmationProblem,
  deleteProject,
  OWNED_COLLECTIONS,
  ProjectConfirmationError,
  ProjectNotFoundError,
  type ProjectContents,
  type ProjectEraser,
} from "./delete"

const project: Project = {
  id: "project-1",
  name: "Woven",
  repo: "MRTHI-Tech/woven",
  previewUrl: "https://woven-preview.a.run.app",
  defaultBranch: "main",
  configPath: "drift.config.json",
  installationId: null,
  createdAt: new Date("2026-08-01"),
  driftScore: 12,
  lastRunAt: new Date("2026-08-08"),
}

const contents: ProjectContents = {
  runs: 6,
  screens: 12,
  archetypes: 2,
  conventions: 4,
  findings: 63,
  resolutions: 23,
  screenshots: 0,
}

/** An eraser that records what it was asked to do, in order. */
function fakeEraser(overrides: Partial<ProjectEraser> = {}) {
  const steps: string[] = []

  const eraser: ProjectEraser = {
    async count() {
      steps.push("count")
      return { ...contents }
    },
    async eraseScreenshots() {
      steps.push("screenshots")
      return 12
    },
    async eraseCollection(_projectId, collection) {
      steps.push(collection)
      return contents[collection]
    },
    async eraseProject() {
      steps.push("project")
    },
    ...overrides,
  }

  return { eraser, steps }
}

function recordingLogger() {
  const lines: string[] = []
  return { logger: createLogger({}, (line) => lines.push(line)), lines }
}

describe("confirmationProblem", () => {
  it("accepts the project's own name", () => {
    expect(confirmationProblem(project, "Woven")).toBeNull()
  })

  it("accepts a name with stray whitespace around it", () => {
    expect(confirmationProblem(project, "  Woven  ")).toBeNull()
  })

  it("refuses a name that is only close", () => {
    expect(confirmationProblem(project, "woven")).toContain("Type Woven to remove it")
  })

  it("refuses nothing typed at all", () => {
    expect(confirmationProblem(project, "")).not.toBeNull()
  })

  it("says it cannot be undone, because it cannot", () => {
    expect(confirmationProblem(project, "")).toContain("cannot be undone")
  })
})

describe("deleteProject", () => {
  it("removes the project and everything scoped to it", async () => {
    const repositories = fakeRepositories({ projects: [project] })
    const { eraser } = fakeEraser()

    const result = await deleteProject({
      projectId: "project-1",
      confirmName: "Woven",
      repositories,
      eraser,
    })

    expect(result.deleted).toEqual({ ...contents, screenshots: 12 })
    expect(result.repo).toBe("MRTHI-Tech/woven")
  })

  it("erases the images first and the project document last", async () => {
    const repositories = fakeRepositories({ projects: [project] })
    const { eraser, steps } = fakeEraser()

    await deleteProject({
      projectId: "project-1",
      confirmName: "Woven",
      repositories,
      eraser,
    })

    expect(steps).toEqual(["count", "screenshots", ...OWNED_COLLECTIONS, "project"])
  })

  it("removes the resolutions too, which nothing else in Drift ever deletes", async () => {
    const repositories = fakeRepositories({ projects: [project] })
    const { eraser, steps } = fakeEraser()

    await deleteProject({
      projectId: "project-1",
      confirmName: "Woven",
      repositories,
      eraser,
    })

    expect(steps).toContain("resolutions")
  })

  it("refuses a name that does not match, and touches nothing", async () => {
    const repositories = fakeRepositories({ projects: [project] })
    const { eraser, steps } = fakeEraser()

    await expect(
      deleteProject({
        projectId: "project-1",
        confirmName: "woven",
        repositories,
        eraser,
      }),
    ).rejects.toBeInstanceOf(ProjectConfirmationError)

    expect(steps).toEqual([])
  })

  it("refuses a project that is not there", async () => {
    const repositories = fakeRepositories()
    const { eraser, steps } = fakeEraser()

    await expect(
      deleteProject({
        projectId: "missing",
        confirmName: "Woven",
        repositories,
        eraser,
      }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError)

    expect(steps).toEqual([])
  })

  it("leaves the project document behind when a collection fails", async () => {
    const repositories = fakeRepositories({ projects: [project] })
    const { eraser, steps } = fakeEraser({
      async eraseCollection(_projectId, collection) {
        steps.push(collection)
        if (collection === "findings") throw new Error("Firestore said no")
        return contents[collection]
      },
    })

    await expect(
      deleteProject({
        projectId: "project-1",
        confirmName: "Woven",
        repositories,
        eraser,
      }),
    ).rejects.toThrow("Firestore said no")

    // The project is still there, so removing it can simply be asked for again.
    expect(steps).not.toContain("project")
  })

  it("logs what it counted and what it removed", async () => {
    const repositories = fakeRepositories({ projects: [project] })
    const { eraser } = fakeEraser()
    const { logger, lines } = recordingLogger()

    await deleteProject({
      projectId: "project-1",
      confirmName: "Woven",
      repositories,
      eraser,
      logger,
    })

    const phases = lines.map((line) => JSON.parse(line).phase)
    expect(phases).toEqual(["project.delete_started", "project.deleted"])
    expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({
      projectId: "project-1",
      findings: 63,
      screenshots: 12,
    })
  })
})
