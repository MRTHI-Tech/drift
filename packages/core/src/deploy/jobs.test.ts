import { describe, expect, it } from "vitest"

import { jobRunBody, jobRunUrl, workerArgs } from "./jobs"

const REQUEST = {
  googleCloudProject: "drift-dev",
  region: "us-central1",
  projectId: "proj1",
  trigger: "deploy" as const,
}

describe("jobRunUrl", () => {
  it("addresses the worker job by the name deploy.md creates", () => {
    expect(jobRunUrl("drift-dev", "us-central1")).toBe(
      "https://run.googleapis.com/v2/projects/drift-dev/locations/us-central1/jobs/drift-worker:run",
    )
  })
})

describe("workerArgs", () => {
  it("carries the project and the trigger the run will record", () => {
    expect(workerArgs(REQUEST)).toEqual(["run", "--project", "proj1", "--trigger", "deploy"])
  })

  it("says scheduled when the scheduler is what asked", () => {
    expect(workerArgs({ ...REQUEST, trigger: "scheduled" })).toContain("scheduled")
  })

  it("passes each route through as its own flag", () => {
    expect(workerArgs({ ...REQUEST, routes: ["/", "/pricing"] })).toEqual([
      "run",
      "--project",
      "proj1",
      "--trigger",
      "deploy",
      "--route",
      "/",
      "--route",
      "/pricing",
    ])
  })
})

describe("jobRunBody", () => {
  it("overrides the container's args and nothing else", () => {
    expect(jobRunBody(REQUEST)).toEqual({
      overrides: {
        containerOverrides: [
          { args: ["run", "--project", "proj1", "--trigger", "deploy"] },
        ],
      },
    })
  })
})
