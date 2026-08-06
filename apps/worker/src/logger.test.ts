import { describe, expect, it } from "vitest"

import { createLogger, errorMessage } from "./logger"

function collect(): { lines: string[]; sink: (line: string) => void } {
  const lines: string[] = []
  return { lines, sink: (line) => lines.push(line) }
}

describe("createLogger", () => {
  it("writes one JSON object per line, carrying its context", () => {
    const { lines, sink } = collect()

    createLogger({ runId: "run1", projectId: "proj1" }, sink).log("run.start", { trigger: "manual" })

    expect(JSON.parse(lines[0] ?? "")).toEqual({
      severity: "INFO",
      phase: "run.start",
      runId: "run1",
      projectId: "proj1",
      trigger: "manual",
    })
  })

  it("marks errors so Cloud Run reads them as errors", () => {
    const { lines, sink } = collect()

    createLogger({}, sink).error("run.error", { message: "boom" })

    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ severity: "ERROR", message: "boom" })
  })

  it("adds standing fields to a child without touching its parent", () => {
    const { lines, sink } = collect()
    const parent = createLogger({ runId: "run1" }, sink)

    parent.child({ route: "/pricing" }).log("render.target_start")
    parent.log("run.finish")

    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ runId: "run1", route: "/pricing" })
    expect(JSON.parse(lines[1] ?? "")).not.toHaveProperty("route")
  })
})

describe("errorMessage", () => {
  it("reads the message off an Error", () => {
    expect(errorMessage(new Error("no response"))).toBe("no response")
  })

  it("stringifies anything else", () => {
    expect(errorMessage("plain")).toBe("plain")
  })
})
