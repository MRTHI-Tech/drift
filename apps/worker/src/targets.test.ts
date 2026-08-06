import { describe, expect, it } from "vitest"

import { buildTargets, describeTarget, filterTargets, targetUrl } from "./targets"

describe("buildTargets", () => {
  it("pairs every route with every viewport, route-major", () => {
    const targets = buildTargets({ routes: ["/", "/pricing"], viewports: ["mobile", "desktop"] })

    expect(targets).toEqual([
      { route: "/", viewport: "mobile" },
      { route: "/", viewport: "desktop" },
      { route: "/pricing", viewport: "mobile" },
      { route: "/pricing", viewport: "desktop" },
    ])
  })

  it("renders only the viewports the config declares", () => {
    const targets = buildTargets({ routes: ["/"], viewports: ["desktop"] })

    expect(targets).toEqual([{ route: "/", viewport: "desktop" }])
  })
})

describe("filterTargets", () => {
  const targets = buildTargets({ routes: ["/", "/pricing"], viewports: ["mobile"] })

  it("keeps everything when nothing is asked for", () => {
    expect(filterTargets(targets, [])).toEqual(targets)
  })

  it("keeps only the routes asked for", () => {
    expect(filterTargets(targets, ["/pricing"])).toEqual([
      { route: "/pricing", viewport: "mobile" },
    ])
  })

  it("returns nothing when the route was never declared", () => {
    expect(filterTargets(targets, ["/nope"])).toEqual([])
  })
})

describe("targetUrl", () => {
  it("appends the route to the preview URL", () => {
    expect(targetUrl("https://preview.example.com", "/pricing")).toBe(
      "https://preview.example.com/pricing",
    )
  })

  it("keeps a base path on the preview URL", () => {
    expect(targetUrl("https://example.com/app", "/pricing")).toBe("https://example.com/app/pricing")
  })

  it("does not double the slash on a trailing-slash preview URL", () => {
    expect(targetUrl("https://example.com/", "/")).toBe("https://example.com/")
  })

  it("keeps a route's query string", () => {
    expect(targetUrl("https://example.com", "/search?q=drift")).toBe(
      "https://example.com/search?q=drift",
    )
  })

  it("rejects a preview URL that is not http", () => {
    expect(() => targetUrl("file:///tmp", "/")).toThrow(/http/)
    expect(() => targetUrl("not a url", "/")).toThrow(/not a URL/)
  })
})

describe("describeTarget", () => {
  it("reads as a route and a viewport", () => {
    expect(describeTarget({ route: "/pricing", viewport: "desktop" })).toBe("/pricing (desktop)")
  })
})
