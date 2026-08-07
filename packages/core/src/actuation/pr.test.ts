import { describe, expect, it } from "vitest"

import { OPENED_BY_DRIFT } from "./constants"
import { evidenceSentence, tokenSentence } from "./evidence"
import { NEAREST_TOKEN, PATTERN_FINDING, SOURCE_FILES, TOKEN_FINDING } from "./fixtures"
import { planFindingPatch } from "./patch"
import { pullRequestBody, pullRequestTitle, type ComposeInput } from "./pr"

function compose(overrides: Partial<ComposeInput> = {}): ComposeInput {
  return {
    finding: PATTERN_FINDING,
    plan: planFindingPatch(PATTERN_FINDING, "conform", SOURCE_FILES),
    route: "/pricing",
    viewport: "mobile",
    direction: "conform",
    before: { url: "https://example.test/before.png", caption: "/pricing as it renders now." },
    after: { url: "https://example.test/after.png", caption: "/checkout/step-2 already does." },
    opener: "resolution",
    ...overrides,
  }
}

describe("evidenceSentence", () => {
  it("uses the line the judgment phase wrote, exactly as stored", () => {
    expect(evidenceSentence(PATTERN_FINDING)).toBe(
      "This screen says Next. 4 sibling screens say Continue.",
    )
  })

  it("writes its own for a token finding, which has none", () => {
    expect(evidenceSentence(TOKEN_FINDING)).toBe(
      `This screen renders rgb(255, 0, 0) for background-color. ` +
        `The nearest token is ${NEAREST_TOKEN.name} at ${NEAREST_TOKEN.value}.`,
    )
  })

  it("says so when the value is on no scale at all", () => {
    const orphan = {
      ...TOKEN_FINDING,
      evidence: { ...TOKEN_FINDING.evidence, expectedSource: null, expectedValue: "" },
    }

    expect(tokenSentence(orphan)).toContain("It is on no scale the token file declares.")
  })
})

describe("pullRequestTitle", () => {
  it("names both values and the route", () => {
    expect(pullRequestTitle(compose())).toBe("Use Continue instead of Next on /pricing")
  })

  it("says where the change lands when it is the siblings changing", () => {
    const plan = planFindingPatch(PATTERN_FINDING, "siblings", SOURCE_FILES)

    expect(pullRequestTitle(compose({ direction: "siblings", plan }))).toBe(
      "Use Next instead of Continue across the product",
    )
  })
})

describe("pullRequestBody", () => {
  it("opens with the finding's own evidence sentence", () => {
    expect(pullRequestBody(compose()).startsWith(evidenceSentence(PATTERN_FINDING))).toBe(true)
  })

  it("ends with the line that says who opened it", () => {
    expect(pullRequestBody(compose()).trimEnd().endsWith(OPENED_BY_DRIFT)).toBe(true)
  })

  it("embeds both images", () => {
    const body = pullRequestBody(compose())

    expect(body).toContain("![Before](https://example.test/before.png)")
    expect(body).toContain("![After](https://example.test/after.png)")
  })

  it("has no before and after section when there are no images", () => {
    const body = pullRequestBody(compose({ before: null, after: null }))

    expect(body).not.toContain("## Before and after")
    expect(body).toContain(OPENED_BY_DRIFT)
  })

  it("lists every file it touches and how many times", () => {
    const body = pullRequestBody(compose())

    expect(body).toContain("| `app/pricing/page.tsx` | 1 |")
  })

  it("names the token when it is conforming to one", () => {
    const body = pullRequestBody(
      compose({
        finding: TOKEN_FINDING,
        plan: planFindingPatch(TOKEN_FINDING, "conform", SOURCE_FILES),
      }),
    )

    expect(body).toContain(`which is the value of \`${NEAREST_TOKEN.name}\``)
  })

  it("says whether a person asked for it", () => {
    expect(pullRequestBody(compose({ opener: "run" }))).toContain("without being asked")
    expect(pullRequestBody(compose({ opener: "resolution" }))).toContain("You resolved this finding")
  })

  it("states the boundary of what Drift will change", () => {
    expect(pullRequestBody(compose())).toContain(
      "Anything needing a judgment about code structure is left for you.",
    )
  })

  it("breaks none of the copy rules in AGENTS.md section 6", () => {
    // The prose, with the markdown taken out: an image is written `![alt](url)`
    // and its exclamation mark is syntax rather than a raised voice.
    const prose = pullRequestBody(compose()).replace(/!\[[^\]]*\]\([^)]*\)/g, "")

    expect(prose).not.toContain("—")
    expect(prose).not.toContain("!")
    for (const filler of ["seamlessly", "effortlessly", "powerful", "robust", "leverage"]) {
      expect(prose.toLowerCase()).not.toContain(filler)
    }
  })
})
