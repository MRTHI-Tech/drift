import { describe, expect, it } from "vitest"

import { copyTone, detectCase, isImperative, tallyCopy } from "./copy"

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

describe("copyTone", () => {
  it("reads a line that speaks to a person as warm", () => {
    expect(copyTone("Hey, how are you?")).toBe("warm")
    expect(copyTone("Let's get you set up")).toBe("warm")
    expect(copyTone("Welcome back")).toBe("warm")
    expect(copyTone("We'll take it from here")).toBe("warm")
  })

  it("reads a line that has stopped addressing anybody as formal", () => {
    expect(copyTone("Personal information")).toBe("formal")
    expect(copyTone("Account details")).toBe("formal")
    expect(copyTone("Terms and conditions")).toBe("formal")
  })

  it("lets the heavier side win a line that holds both", () => {
    expect(copyTone("Please provide your details")).toBe("formal")
    expect(copyTone("Hey, please continue")).toBe("neutral")
  })

  it("calls a line with neither register neutral", () => {
    expect(copyTone("Pricing")).toBe("neutral")
    expect(copyTone("Step 2")).toBe("neutral")
    expect(copyTone("")).toBe("neutral")
  })

  it("reads a contraction through its stem and its ending alike", () => {
    // "let's" counts through "let"; "we're" counts through both "we" and "'re".
    expect(copyTone("Let's begin")).toBe("warm")
    expect(copyTone("We're almost done")).toBe("warm")
  })

  it("does not take a possessive for a contraction", () => {
    expect(copyTone("The plan's information")).toBe("formal")
  })

  it("gives the same answer every time it is asked", () => {
    const line = "Please confirm your details"
    expect(copyTone(line)).toBe(copyTone(line))
  })
})
