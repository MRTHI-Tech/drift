import { describe, expect, it } from "vitest"

import {
  BACK_SELECTOR,
  CONVENTION_HEADING_SIZE,
  HEADING_SELECTOR,
  NEXT_SELECTOR,
  PLANTED_HEADING_SIZE,
  PLANTED_LABEL,
  stepScreen,
  stepStyles,
  stepText,
} from "./fixtures"
import { buildProfile, firstHeadingSelector, profileValue, terminalActionSelector } from "./profile"

function profileOf(step: number) {
  const screen = stepScreen(step)
  return buildProfile({
    signature: screen.signature!,
    computedStyles: screen.computedStyles,
    text: screen.text,
  })
}

describe("terminalActionSelector", () => {
  it("takes the bottom-most, right-most action, not the first one", () => {
    const screen = stepScreen(2)

    expect(terminalActionSelector(screen.signature!)).toBe(NEXT_SELECTOR)
  })

  it("takes the only action when a screen has one", () => {
    const screen = stepScreen(2)
    const alone = {
      ...screen.signature!,
      interactive: screen.signature!.interactive.filter(
        (element) => element.selector === BACK_SELECTOR,
      ),
    }

    expect(terminalActionSelector(alone)).toBe(BACK_SELECTOR)
  })

  it("has no anchor on a screen that offers nothing", () => {
    const screen = stepScreen(2)

    expect(terminalActionSelector({ ...screen.signature!, interactive: [] })).toBeNull()
  })
})

describe("firstHeadingSelector", () => {
  it("takes the topmost heading", () => {
    expect(firstHeadingSelector(stepStyles(1))).toBe(HEADING_SELECTOR)
  })

  it("has no anchor on a screen with no heading", () => {
    const styles = stepStyles(1)
    delete styles[HEADING_SELECTOR]

    expect(firstHeadingSelector(styles)).toBeNull()
  })
})

describe("buildProfile", () => {
  it("reads values exactly as the extraction recorded them", () => {
    expect(profileOf(2)).toEqual([
      { property: "cta.label", kind: "copy", selector: NEXT_SELECTOR, value: "Continue" },
      { property: "cta.size", kind: "style", selector: NEXT_SELECTOR, value: "16px" },
      { property: "cta.radius", kind: "style", selector: NEXT_SELECTOR, value: "8px" },
      {
        property: "heading.size",
        kind: "style",
        selector: HEADING_SELECTOR,
        value: CONVENTION_HEADING_SIZE,
      },
      { property: "heading.weight", kind: "style", selector: HEADING_SELECTOR, value: "700" },
    ])
  })

  it("reads the drifted step's own values, without correcting them", () => {
    const profile = profileOf(6)

    expect(profileValue(profile, "cta.label")?.value).toBe(PLANTED_LABEL)
    expect(profileValue(profile, "heading.size")?.value).toBe(PLANTED_HEADING_SIZE)
  })

  it("leaves out a property whose element the screen does not have", () => {
    const computedStyles = stepStyles(1)
    delete computedStyles[HEADING_SELECTOR]
    const screen = stepScreen(1, { computedStyles })

    const profile = buildProfile({
      signature: screen.signature!,
      computedStyles,
      text: stepText(1),
    })

    expect(profileValue(profile, "heading.size")).toBeNull()
    expect(profileValue(profile, "cta.label")?.value).toBe("Get started")
  })

  it("reads a label out of the children when the element has no text of its own", () => {
    const text = stepText(2)
    delete text[NEXT_SELECTOR]
    text[`${NEXT_SELECTOR} > span:nth-of-type(1)`] = "Continue"
    const screen = stepScreen(2, { text })

    const profile = buildProfile({
      signature: screen.signature!,
      computedStyles: screen.computedStyles,
      text,
    })

    expect(profileValue(profile, "cta.label")?.value).toBe("Continue")
  })
})
