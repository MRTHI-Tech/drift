import { describe, expect, it } from "vitest"

import { silentLogger, type AgentLogger } from "./logging"
import { isWorthAskingAgain } from "./flows/propose-fix"
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

describe("attemptOrEmpty, on a failure that cannot come out differently", () => {
  it("does not spend the retry", async () => {
    let calls = 0

    const result = await attemptOrEmpty(
      async () => {
        calls += 1
        throw new Error("ABORTED: Exceeded maximum tool call iterations (20)")
      },
      {
        name: "test",
        empty: "",
        logger: silentLogger,
        sleep: noWait,
        retryable: () => false,
      },
    )

    expect(result).toBe("")
    expect(calls).toBe(1)
  })

  it("still says it gave up, so the run log reads the same either way", async () => {
    const logger = recordingLogger()

    await attemptOrEmpty(
      async () => {
        throw new Error("ABORTED")
      },
      { name: "test", empty: "", logger, sleep: noWait, retryable: () => false },
    )

    expect(logger.errors).toEqual(["model.attempt_failed", "model.gave_up"])
  })

  it("retries everything when the caller does not say otherwise", async () => {
    let calls = 0

    await attemptOrEmpty(
      async () => {
        calls += 1
        throw new Error("anything")
      },
      { name: "test", empty: "", logger: silentLogger, sleep: noWait },
    )

    expect(calls).toBe(2)
  })

  it("waits as long as the caller asked before trying again", async () => {
    const waits: number[] = []

    await attemptOrEmpty(
      async () => {
        throw new Error("503")
      },
      {
        name: "test",
        empty: "",
        logger: silentLogger,
        sleep: async (ms) => {
          waits.push(ms)
        },
        backoffMs: 5000,
      },
    )

    expect(waits).toEqual([5000])
  })
})

describe("isWorthAskingAgain", () => {
  it("is false for a model that ran out of tool calls", () => {
    expect(isWorthAskingAgain(new Error("ABORTED: Exceeded maximum tool call iterations (20)"))).toBe(
      false,
    )
  })

  it("is true for a service that could not answer", () => {
    expect(
      isWorthAskingAgain(new Error("UNAVAILABLE: [503 Service Unavailable] high demand")),
    ).toBe(true)
  })

  it("is true for anything it does not recognise", () => {
    expect(isWorthAskingAgain(new Error("socket hang up"))).toBe(true)
    expect(isWorthAskingAgain("not an error at all")).toBe(true)
  })
})

