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
    // English, not CSS: the property reads as "background colour" rather than
    // as the stylesheet keyword it was measured from.
    expect(evidenceSentence(TOKEN_FINDING)).toBe(
      `This screen's background colour is rgb(255, 0, 0). ` +
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
    // The default plan is mechanical, and what bounds a mechanical patch is
    // that it never read the code. The Fixer's version of this sentence, and
    // why the two must differ, is below.
    expect(pullRequestBody(compose())).toContain("did not read the code around it")
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

describe("pullRequestBody, on how far to trust the change", () => {
  const bodyFor = (author: "mechanical" | "model") =>
    pullRequestBody(
      compose({ plan: { ...planFindingPatch(TOKEN_FINDING, "conform", SOURCE_FILES), author } }),
    )

  it("says a mechanical patch never read the code", () => {
    const body = bodyFor("mechanical")

    expect(body).toContain("character for character")
    expect(body).toContain("did not read the code around it")
  })

  it("says plainly that the Fixer read the code, and calls it a proposal", () => {
    const body = bodyFor("model")

    expect(body).toContain("by reading your code")
    expect(body).toContain("proposal")
  })

  it("never tells a reviewer of a Fixer patch that Drift does not read code", () => {
    // The whole point. This sentence was true of every pull request until the
    // Fixer existed, and went on being printed under patches it was false of.
    expect(bodyFor("model")).not.toContain("did not read the code around it")
  })

  it("names what the gate checked and what it could not", () => {
    const body = bodyFor("model")

    expect(body).toContain("applies to a file it actually read")
    expect(body).toContain("did **not** check that the result compiles")
    expect(body).toContain("draft")
  })

  it("still ends every body the same way, whoever wrote the patch", () => {
    expect(bodyFor("mechanical").trimEnd().endsWith(OPENED_BY_DRIFT)).toBe(true)
    expect(bodyFor("model").trimEnd().endsWith(OPENED_BY_DRIFT)).toBe(true)
  })
})

