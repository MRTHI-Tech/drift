import { describe, expect, it } from "vitest"

import type { Convention } from "../types"
import { RULES_HEADER } from "./constants"
import {
  BUTTON_RADIUS_CONVENTION,
  CTA_LABEL_CONVENTION,
  HEADING_SIZE_CONVENTION,
  PROJECT,
  signatureWithCopy,
} from "./fixtures"
import { renderRulesFile, ruleLine, summarizeCopyVoice } from "./rules"

const routes = new Map([["screen-pricing", "/pricing"]])

function render(conventions: Convention[] = [CTA_LABEL_CONVENTION, HEADING_SIZE_CONVENTION]) {
  return renderRulesFile({
    projectName: PROJECT.name,
    archetypes: [
      {
        label: "Checkout step",
        conventions,
        signatures: [signatureWithCopy(), signatureWithCopy(), signatureWithCopy()],
      },
    ],
    productWide: [],
    routes,
  })
}

describe("renderRulesFile", () => {
  it("carries the header that says not to edit it by hand", () => {
    expect(render()).toContain(RULES_HEADER)
  })

  it("names the project and the archetype", () => {
    const file = render()

    expect(file).toContain("# Drift rules for Acme")
    expect(file).toContain("## Checkout step")
  })

  it("writes every convention as an instruction rather than an observation", () => {
    const file = render()

    expect(file).toContain('- Label the last action on the screen "Continue".')
    expect(file).toContain("- Set the font size of the first heading to 24px.")
  })

  it("separates what a screen says from how it is typeset", () => {
    const file = render()
    const labels = file.indexOf("### Labels")
    const type = file.indexOf("### Type")

    expect(labels).toBeGreaterThan(-1)
    expect(type).toBeGreaterThan(labels)
  })

  it("states the copy voice the screens agree on", () => {
    const file = render()

    expect(file).toContain("### Copy voice")
    expect(file).toContain("- Write action labels in sentence case.")
    expect(file).toContain("- Open an action label with a verb, as most of these screens do.")
  })

  it("records an exception as an instruction to leave the screen alone", () => {
    const file = render([
      {
        ...CTA_LABEL_CONVENTION,
        exceptions: [{ screenId: "screen-pricing", reason: "it is the marketing page" }],
      },
    ])

    expect(file).toContain("### Recorded exceptions")
    expect(file).toContain(
      "- /pricing is allowed to differ on the label of the last action on the screen. " +
        "Leave it as it is. Reason: it is the marketing page",
    )
  })

  it("says nothing about a convention the user removed", () => {
    const file = render([{ ...CTA_LABEL_CONVENTION, status: "removed" }, HEADING_SIZE_CONVENTION])

    expect(file).not.toContain("Continue")
    expect(file).toContain("24px")
  })

  it("says so plainly when nothing has been measured yet", () => {
    const file = renderRulesFile({
      projectName: "Acme",
      archetypes: [],
      productWide: [],
      routes: new Map(),
    })

    expect(file).toContain(RULES_HEADER)
    expect(file).toContain("No conventions have been measured yet.")
  })

  it("carries no timestamp, so an unchanged product regenerates an identical file", () => {
    expect(render()).toBe(render())
  })

  it("states a component convention under everywhere, because that is where it holds", () => {
    const file = renderRulesFile({
      projectName: PROJECT.name,
      archetypes: [],
      productWide: [BUTTON_RADIUS_CONVENTION],
      routes,
    })

    expect(file).toContain("## Everywhere")
    expect(file).toContain("- Set the corner radius of every button to 999px.")
  })

  it("names the control in an exception on a component convention", () => {
    const file = renderRulesFile({
      projectName: PROJECT.name,
      archetypes: [],
      productWide: [
        {
          ...BUTTON_RADIUS_CONVENTION,
          exceptions: [{ screenId: "screen-pricing", reason: "the pill is the marketing style" }],
        },
      ],
      routes,
    })

    expect(file).toContain(
      "- /pricing is allowed to differ on the corner radius of its buttons. " +
        "Leave it as it is. Reason: the pill is the marketing style",
    )
  })
})

describe("ruleLine", () => {
  it("attaches the count the rule rests on", () => {
    expect(ruleLine(CTA_LABEL_CONVENTION)).toContain("Measured on 4 screens.")
  })

  it("says when the family has not settled", () => {
    expect(ruleLine({ ...CTA_LABEL_CONVENTION, confidence: "low" })).toContain(
      "has not settled on one value",
    )
  })

  it("says when the value was chosen rather than counted", () => {
    expect(ruleLine({ ...CTA_LABEL_CONVENTION, status: "promoted" })).toContain(
      "You chose this value.",
    )
  })

  it("tells an agent to apply a component convention wherever it writes one", () => {
    // "Every", because an agent reading this is about to write a control
    // somewhere the product has not been measured.
    expect(ruleLine(BUTTON_RADIUS_CONVENTION)).toBe(
      "Set the corner radius of every button to 999px. Measured on 4 screens.",
    )
  })

  it("falls back to the property name for something it has no phrasing for", () => {
    expect(ruleLine({ ...CTA_LABEL_CONVENTION, property: "hero.parallax" })).toContain(
      "Set hero.parallax to Continue.",
    )
  })
})

describe("summarizeCopyVoice", () => {
  it("counts across every screen rather than trusting one", () => {
    const voice = summarizeCopyVoice([signatureWithCopy(), signatureWithCopy()])

    expect(voice.screens).toBe(2)
    expect(voice.labelCase).toBe("sentence")
    expect(voice.imperativeShare).toBeCloseTo(0.75)
  })

  it("states no case when the screens are split down the middle", () => {
    const split = signatureWithCopy({
      labels: {
        count: 4,
        sentence: 2,
        title: 2,
        upper: 0,
        lower: 0,
        other: 0,
        imperative: 0,
        dominantCase: null,
      },
    })

    expect(summarizeCopyVoice([split]).labelCase).toBeNull()
  })

  it("has nothing to say about screens with no labels at all", () => {
    const silent = signatureWithCopy({
      labels: {
        count: 0,
        sentence: 0,
        title: 0,
        upper: 0,
        lower: 0,
        other: 0,
        imperative: 0,
        dominantCase: null,
      },
    })

    expect(summarizeCopyVoice([silent]).labelCase).toBeNull()
    expect(summarizeCopyVoice([silent]).imperativeShare).toBe(0)
  })
})
