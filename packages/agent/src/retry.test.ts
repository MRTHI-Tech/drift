import { describe, expect, it } from "vitest"

import { silentLogger, type AgentLogger } from "./logging"
import { attemptOrEmpty } from "./retry"

const noWait = async (): Promise<void> => {}

function recordingLogger(): AgentLogger & { errors: string[] } {
  const errors: string[] = []
  return {
    errors,
    log() {},
    error(phase) {
      errors.push(phase)
    },
  }
}

describe("attemptOrEmpty", () => {
  it("returns the first answer when the call works", async () => {
    let calls = 0

    const result = await attemptOrEmpty(
      async () => {
        calls += 1
        return "ok"
      },
      { name: "test", empty: "", logger: silentLogger, sleep: noWait },
    )

    expect(result).toBe("ok")
    expect(calls).toBe(1)
  })

  it("retries once and takes the second answer", async () => {
    let calls = 0

    const result = await attemptOrEmpty(
      async () => {
        calls += 1
        if (calls === 1) throw new Error("503")
        return "ok"
      },
      { name: "test", empty: "", logger: silentLogger, sleep: noWait },
    )

    expect(result).toBe("ok")
    expect(calls).toBe(2)
  })

  it("returns empty on the second failure rather than throwing", async () => {
    let calls = 0
    const logger = recordingLogger()

    const result = await attemptOrEmpty(
      async () => {
        calls += 1
        throw new Error("503")
      },
      { name: "judgePatternDrift", empty: [], logger, sleep: noWait },
    )

    expect(result).toEqual([])
    expect(calls).toBe(2)
    expect(logger.errors).toEqual(["model.attempt_failed", "model.gave_up"])
  })

  it("never tries a third time", async () => {
    let calls = 0

    await attemptOrEmpty(
      async () => {
        calls += 1
        throw new Error("boom")
      },
      { name: "test", empty: null, logger: silentLogger, sleep: noWait },
    )

    expect(calls).toBe(2)
  })

  it("waits before the retry", async () => {
    const waits: number[] = []
    let calls = 0

    await attemptOrEmpty(
      async () => {
        calls += 1
        if (calls === 1) throw new Error("429")
        return "ok"
      },
      {
        name: "test",
        empty: "",
        logger: silentLogger,
        sleep: async (ms) => {
          waits.push(ms)
        },
      },
    )

    expect(waits).toEqual([750])
  })
})
