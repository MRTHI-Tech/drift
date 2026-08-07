import { describe, expect, it } from "vitest"

import { DEFAULT_TRIGGER, parseTrigger } from "./trigger"

describe("parseTrigger", () => {
  it("reads the trigger Cloud Scheduler and the deploy webhook pass", () => {
    expect(parseTrigger("scheduled")).toBe("scheduled")
    expect(parseTrigger("deploy")).toBe("deploy")
  })

  it("is manual when nobody says otherwise", () => {
    expect(parseTrigger(undefined)).toBe(DEFAULT_TRIGGER)
    expect(DEFAULT_TRIGGER).toBe("manual")
  })

  it("is null for anything else, rather than quietly manual", () => {
    expect(parseTrigger("cron")).toBeNull()
    expect(parseTrigger("")).toBeNull()
    expect(parseTrigger("  ")).toBeNull()
  })
})
