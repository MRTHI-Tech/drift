import { describe, expect, it } from "vitest"

import { screenshotObjectPath, slugifyRoute } from "./screenshot-path"

const base = { projectId: "proj1", runId: "run1", viewport: "mobile" } as const

describe("slugifyRoute", () => {
  it("names the root route", () => {
    expect(slugifyRoute("/")).toBe("index")
  })

  it("flattens a nested route", () => {
    expect(slugifyRoute("/settings/billing")).toBe("settings-billing")
  })

  it("lowercases and strips anything that is not a filename character", () => {
    expect(slugifyRoute("/Search?q=Drift%20now")).toBe("search-q-drift-20now")
  })

  it("never ends on a dash, even after the length cap", () => {
    const slug = slugifyRoute(`/${"a".repeat(58)}/b`)

    expect(slug.length).toBeLessThanOrEqual(60)
    expect(slug.endsWith("-")).toBe(false)
  })
})

describe("screenshotObjectPath", () => {
  it("puts a run's screenshots under its project and run", () => {
    const path = screenshotObjectPath({ ...base, route: "/pricing" })

    expect(path).toMatch(/^screens\/proj1\/run1\/pricing-[0-9a-f]{8}-mobile\.png$/)
  })

  it("is stable for the same target", () => {
    expect(screenshotObjectPath({ ...base, route: "/pricing" })).toBe(
      screenshotObjectPath({ ...base, route: "/pricing" }),
    )
  })

  it("separates routes that slugify the same way", () => {
    expect(screenshotObjectPath({ ...base, route: "/a/b" })).not.toBe(
      screenshotObjectPath({ ...base, route: "/a-b" }),
    )
  })

  it("separates the viewports of one route", () => {
    expect(screenshotObjectPath({ ...base, route: "/", viewport: "mobile" })).not.toBe(
      screenshotObjectPath({ ...base, route: "/", viewport: "desktop" }),
    )
  })
})
