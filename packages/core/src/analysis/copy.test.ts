import { describe, expect, it } from "vitest"

import { detectCase, isImperative, tallyCopy } from "./copy"

describe("detectCase", () => {
  it("reads sentence case", () => {
    expect(detectCase("Get started")).toBe("sentence")
    expect(detectCase("Continue")).toBe("sentence")
    expect(detectCase("Read the docs")).toBe("sentence")
  })

  it("reads title case", () => {
    expect(detectCase("Get Started")).toBe("title")
    expect(detectCase("Back to Top")).toBe("title")
  })

  it("reads the shouting cases", () => {
    expect(detectCase("GET STARTED")).toBe("upper")
    expect(detectCase("get started")).toBe("lower")
  })

  it("does not call a proper noun mid-line a case", () => {
    expect(detectCase("Read the Acme guide")).toBe("other")
    expect(detectCase("2026")).toBe("other")
  })

  it("does not let a minor word decide title case", () => {
    expect(detectCase("Terms of service")).toBe("sentence")
  })
})

describe("isImperative", () => {
  it("is true for a label that gives an instruction", () => {
    expect(isImperative("Get started")).toBe(true)
    expect(isImperative("Save changes")).toBe(true)
    expect(isImperative("continue")).toBe(true)
  })

  it("is false for a label that describes something", () => {
    expect(isImperative("Getting started")).toBe(false)
    expect(isImperative("Your plan")).toBe(false)
    expect(isImperative("Need help?")).toBe(false)
    expect(isImperative("")).toBe(false)
  })
})

describe("tallyCopy", () => {
  it("counts every line and calls a majority", () => {
    const tally = tallyCopy(["Get started", "Read the docs", "Contact Sales"])

    expect(tally).toMatchObject({ count: 3, sentence: 2, title: 1, imperative: 3 })
    expect(tally.dominantCase).toBe("sentence")
  })

  it("calls no case dominant when none has a majority", () => {
    expect(tallyCopy(["Get started", "Get Started"]).dominantCase).toBeNull()
  })

  it("skips blank lines and does not depend on order", () => {
    const lines = ["Save changes", "  ", "Your plan"]

    expect(tallyCopy(lines)).toEqual(tallyCopy([...lines].reverse()))
    expect(tallyCopy(lines).count).toBe(2)
  })

  it("is empty for nothing at all", () => {
    expect(tallyCopy([])).toMatchObject({ count: 0, dominantCase: null })
  })
})
