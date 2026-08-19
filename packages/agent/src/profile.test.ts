import type { Screen } from "@drift/core"
import { describe, expect, it } from "vitest"

import {
  BACK_SELECTOR,
  CONTAINER_SELECTOR,
  CONVENTION_HEADING_SIZE,
  HEADING_SELECTOR,
  NEXT_SELECTOR,
  PLANTED_HEADING_SIZE,
  PLANTED_LABEL,
  stepScreen,
  stepStyles,
  stepText,
} from "./fixtures"
import {
  buildProfile,
  contentContainerSelector,
  firstHeadingSelector,
  profileValue,
  terminalActionSelector,
} from "./profile"

function profileOfScreen(screen: Screen) {
  return buildProfile({
    signature: screen.signature!,
    computedStyles: screen.computedStyles,
    text: screen.text,
  })
}

function profileOf(step: number) {
  return profileOfScreen(stepScreen(step))
}

describe("terminalActionSelector", () => {
  it("takes the bottom-most, right-most action, not the first one", () => {
    const screen = stepScreen(2)

    expect(terminalActionSelector(screen.signature!, screen.computedStyles)).toBe(NEXT_SELECTOR)
  })

  it("takes the only action when a screen has one", () => {
    const screen = stepScreen(2)
    const alone = {
      ...screen.signature!,
      interactive: screen.signature!.interactive.filter(
        (element) => element.selector === BACK_SELECTOR,
      ),
    }

    expect(terminalActionSelector(alone, screen.computedStyles)).toBe(BACK_SELECTOR)
  })

  it("has no anchor on a screen that offers nothing", () => {
    const screen = stepScreen(2)

    expect(
      terminalActionSelector({ ...screen.signature!, interactive: [] }, screen.computedStyles),
    ).toBeNull()
  })

  it("has no anchor on a screen offering only peers", () => {
    // A question with three answers drawn identically. The bottom answer is
    // not this screen's call to action, so the screen has none.
    const screen = stepScreen(2)
    const choices = ["one", "two", "three"]

    const computedStyles = Object.fromEntries(
      choices.map((name) => [
        `[data-testid='${name}']`,
        {
          tag: "button",
          box: { x: 16, y: 200, width: 358, height: 44 },
          styles: screen.computedStyles[BACK_SELECTOR]!.styles,
        },
      ]),
    )
    const interactive = choices.map((name, index) => ({
      selector: `[data-testid='${name}']`,
      tag: "button",
      label: name,
      x: 16,
      y: 200 + index * 68,
    }))

    expect(
      terminalActionSelector({ ...screen.signature!, interactive }, computedStyles),
    ).toBeNull()
  })

  it("takes the one action that is not a peer", () => {
    const screen = stepScreen(2)
    const computedStyles = {
      ...screen.computedStyles,
      "[data-testid='one']": {
        tag: "button",
        box: { x: 16, y: 200, width: 358, height: 44 },
        styles: screen.computedStyles[BACK_SELECTOR]!.styles,
      },
      "[data-testid='two']": {
        tag: "button",
        box: { x: 16, y: 268, width: 358, height: 44 },
        styles: screen.computedStyles[BACK_SELECTOR]!.styles,
      },
    }
    const interactive = [
      { selector: "[data-testid='one']", tag: "button", label: "one", x: 16, y: 200 },
      { selector: "[data-testid='two']", tag: "button", label: "two", x: 16, y: 268 },
      ...screen.signature!.interactive.filter(
        (element) => element.selector === NEXT_SELECTOR,
      ),
    ]

    expect(
      terminalActionSelector({ ...screen.signature!, interactive }, computedStyles),
    ).toBe(NEXT_SELECTOR)
  })
})

describe("cta.voice", () => {
  it("reads a stock label as generic and a named action as specific", () => {
    // Step 2's action says "Continue"; step 6's says "Next".
    expect(profileValue(profileOf(2), "cta.voice")?.value).toBe("generic")

    const named = stepScreen(2)
    named.text[NEXT_SELECTOR] = "Build our rhythm"
    expect(
      profileValue(
        buildProfile({
          signature: named.signature!,
          computedStyles: named.computedStyles,
          text: named.text,
        }),
        "cta.voice",
      )?.value,
    ).toBe("specific")
  })
})

describe("contentContainerSelector", () => {
  it("takes the element that encloses both anchors", () => {
    const styles = stepStyles(2)

    expect(contentContainerSelector(styles, [HEADING_SELECTOR, NEXT_SELECTOR])).toBe(
      CONTAINER_SELECTOR,
    )
  })

  it("prefers the tighter container to the one it sits inside", () => {
    const styles = stepStyles(2)
    styles["main:nth-of-type(1)"] = {
      tag: "main",
      box: { x: 0, y: 0, width: 390, height: 900 },
      styles: styles[CONTAINER_SELECTOR]!.styles,
    }

    expect(contentContainerSelector(styles, [HEADING_SELECTOR, NEXT_SELECTOR])).toBe(
      CONTAINER_SELECTOR,
    )
  })

  it("never answers with the page itself", () => {
    const styles = stepStyles(2)
    delete styles[CONTAINER_SELECTOR]

    // `body` is all that is left enclosing both, and it is not a container.
    expect(contentContainerSelector(styles, [HEADING_SELECTOR, NEXT_SELECTOR])).toBeNull()
  })

  it("has no container when an anchor has no recorded box", () => {
    expect(contentContainerSelector(stepStyles(2), [HEADING_SELECTOR, "div:nth-of-type(9)"]))
      .toBeNull()
  })
})

describe("content properties", () => {
  it("holds none of them on a screen with no heading to enclose", () => {
    const computedStyles = stepStyles(1)
    delete computedStyles[HEADING_SELECTOR]
    const screen = stepScreen(1, { computedStyles })

    expect(profileValue(profileOfScreen(screen), "content.padding")).toBeNull()
  })

  it("leaves out a value that means the container has none of it", () => {
    // A block container reports `gap: normal`, which is not a decision.
    const computedStyles = stepStyles(2)
    computedStyles[CONTAINER_SELECTOR] = {
      ...computedStyles[CONTAINER_SELECTOR]!,
      styles: { ...computedStyles[CONTAINER_SELECTOR]!.styles, display: "block", gap: "normal" },
    }
    const profile = profileOfScreen(stepScreen(2, { computedStyles }))

    expect(profileValue(profile, "content.gap")).toBeNull()
    expect(profileValue(profile, "content.layout")?.value).toBe("block")
  })
})

describe("heading.tone", () => {
  it("reads the register the heading is written in", () => {
    const warm = stepScreen(2)
    warm.text[HEADING_SELECTOR] = "Hey, how are you?"

    expect(profileValue(profileOfScreen(warm), "heading.tone")?.value).toBe("warm")
  })

  it("reads a screen that has turned into a form as formal", () => {
    const formal = stepScreen(2)
    formal.text[HEADING_SELECTOR] = "Personal information"

    expect(profileValue(profileOfScreen(formal), "heading.tone")?.value).toBe("formal")
  })

  it("holds no tone on a screen with no heading", () => {
    const computedStyles = stepStyles(1)
    delete computedStyles[HEADING_SELECTOR]
    const screen = stepScreen(1, { computedStyles })

    expect(profileValue(profileOfScreen(screen), "heading.tone")).toBeNull()
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
      { property: "cta.voice", kind: "derived", selector: NEXT_SELECTOR, value: "generic" },
      { property: "cta.size", kind: "style", selector: NEXT_SELECTOR, value: "16px" },
      { property: "cta.radius", kind: "style", selector: NEXT_SELECTOR, value: "8px" },
      {
        property: "heading.size",
        kind: "style",
        selector: HEADING_SELECTOR,
        value: CONVENTION_HEADING_SIZE,
      },
      { property: "heading.weight", kind: "style", selector: HEADING_SELECTOR, value: "700" },
      { property: "heading.tone", kind: "derived", selector: HEADING_SELECTOR, value: "neutral" },
      { property: "content.layout", kind: "style", selector: CONTAINER_SELECTOR, value: "flex" },
      {
        property: "content.padding",
        kind: "style",
        selector: CONTAINER_SELECTOR,
        value: "24px 16px",
      },
      { property: "content.gap", kind: "style", selector: CONTAINER_SELECTOR, value: "16px" },
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
