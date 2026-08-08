import { describe, expect, it } from "vitest"

import { createLogger } from "../logging"
import type { Project } from "../types"
import { startFirstRun, workerCommand } from "./first-run"

const project: Project = {
  id: "project-1",
  name: "Woven",
  repo: "MRTHI-Tech/woven",
  previewUrl: "https://woven-preview.a.run.app",
  defaultBranch: "main",
  configPath: "drift.config.json",
  createdAt: new Date("2026-08-08"),
  driftScore: 0,
  lastRunAt: null,
}

function recordingLogger() {
  const lines: string[] = []
  return { logger: createLogger({}, (line) => lines.push(line)), lines }
}

describe("startFirstRun", () => {
  it("starts nothing when the dashboard is not on Cloud Run", async () => {
    const result = await startFirstRun({ project, onCloudRun: false })

    expect(result.started).toBe(false)
    expect(result.reason).toContain("not running on Cloud Run")
  })

  it("says what to type instead, so a local project is not a dead end", async () => {
    const result = await startFirstRun({ project, onCloudRun: false })

    expect(result.command).toBe("pnpm worker -- run --project project-1")
  })

  it("starts nothing when the Google Cloud project is not named", async () => {
    const result = await startFirstRun({
      project,
      onCloudRun: true,
      googleCloudProject: undefined,
    })

    expect(result.started).toBe(false)
    expect(result.reason).toContain("GOOGLE_CLOUD_PROJECT")
  })

  it("reports a failure to start rather than throwing it", async () => {
    // On Cloud Run by claim only: there is no metadata server in a test, so the
    // region lookup fails, which is the path a real refusal takes.
    const result = await startFirstRun({
      project,
      onCloudRun: true,
      googleCloudProject: "drift-504722",
      logger: recordingLogger().logger,
    })

    expect(result.started).toBe(false)
    expect(result.command).toBe("pnpm worker -- run --project project-1")
  })

  it("logs why nothing started", async () => {
    const { logger, lines } = recordingLogger()

    await startFirstRun({ project, onCloudRun: false, logger })

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      phase: "project.first_run_unavailable",
      projectId: "project-1",
    })
  })
})

describe("workerCommand", () => {
  it("names the project the worker should render", () => {
    expect(workerCommand("abc123")).toBe("pnpm worker -- run --project abc123")
  })
})
