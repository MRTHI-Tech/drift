/**
 * The deterministic projection of a rendered screen onto the handful of
 * properties a convention can be stated over. No model call, no judgment: this
 * only reads values that the extraction already recorded, and carries the
 * selector each one was read from.
 *
 * Everything downstream is built on this. Conventions are the values a set of
 * profiles agrees on, divergence candidates are the values one profile
 * disagrees on, and the reconciliation gate (AGENTS.md section 3) re-reads
 * every cited value out of the same extraction record before anything is
 * written. Because a candidate's value is copied out of the record rather than
 * described, a model that reports the value honestly always passes the gate,
 * and a model that alters it never does.
 */

import {
  copyTone,
  HEADING_TAGS,
  labelVoice,
  type BoundingBox,
  type ComputedStyles,
  type ScreenText,
  type Signature,
  type StyleProperty,
} from "@drift/core"

import { DEFAULT_PATTERN_SEVERITY, PATTERN_SEVERITY } from "./constants"

/**
 * Where a property's value is read from, and therefore where it is verified.
 *
 * `style` and `copy` are read straight out of the extraction record. `derived`
 * is worked out from it by a pure function, and the gate verifies one by
 * running that function again rather than by looking the value up: the value is
 * still the record's, arrived at the same way every time, and still not
 * something a model can originate (AGENTS.md section 3).
 */
export type ProfileKind = "style" | "copy" | "derived"

/** One property a convention can be stated over. */
export interface ProfileProperty {
  /** The dotted name stored on a convention and a finding, for example `cta.label`. */
  property: string
  kind: ProfileKind
  /** The recorded CSS property a style value is read from. Null for copy. */
  styleProperty: StyleProperty | null
  /** How a person reads the property, for the log and the dashboard. */
  reads: string
  /**
   * Recorded values that mean the element has none of this property rather
   * than some particular amount of it. A block container reports its `gap` as
   * `normal` and its `max-width` as `none`, which are not decisions anybody
   * made, and a family agreeing on them has agreed on nothing. A screen whose
   * value is one of these holds no value for the property at all, the same way
   * a screen with no heading holds no heading values.
   */
  absentValues?: readonly string[]
}

/**
 * Longest label kept, matching the signature's own cap so a label read here and
 * a label read there are the same string.
 */
export const MAX_LABEL_LENGTH = 80

/** Tags that carry a screen's terminal action. */
const ACTION_TAGS: readonly string[] = ["button", "a"]

/**
 * The properties a convention can be stated over. Deliberately short: every
 * one of them is element-scoped, so every finding drawn from it cites a
 * selector the gate can re-read. A property whose value lives nowhere in the
 * extraction record cannot be verified, so it is not on this list.
 */
export const PROFILE_PROPERTIES: readonly ProfileProperty[] = [
  { property: "cta.label", kind: "copy", styleProperty: null, reads: "last action label" },
  {
    property: "cta.voice",
    kind: "derived",
    styleProperty: null,
    reads: "call to action wording",
  },
  { property: "cta.size", kind: "style", styleProperty: "font-size", reads: "last action type size" },
  { property: "cta.radius", kind: "style", styleProperty: "border-radius", reads: "last action corner radius" },
  { property: "heading.size", kind: "style", styleProperty: "font-size", reads: "first heading type size" },
  { property: "heading.weight", kind: "style", styleProperty: "font-weight", reads: "first heading type weight" },
  { property: "heading.tone", kind: "derived", styleProperty: null, reads: "heading tone" },
  { property: "content.layout", kind: "style", styleProperty: "display", reads: "content container layout" },
  { property: "content.padding", kind: "style", styleProperty: "padding", reads: "content container padding" },
  {
    property: "content.gap",
    kind: "style",
    styleProperty: "gap",
    reads: "space between content blocks",
    absentValues: ["normal", "normal normal"],
  },
  {
    property: "content.width",
    kind: "style",
    styleProperty: "max-width",
    reads: "content container width limit",
    absentValues: ["none"],
  },
]

const BY_NAME = new Map(PROFILE_PROPERTIES.map((entry) => [entry.property, entry]))

/** The property definition behind a dotted name, or null for one Drift does not read. */
export function profileProperty(property: string): ProfileProperty | null {
  return BY_NAME.get(property) ?? null
}

/** How loud a finding on a property is. Fixed per property, never asked for. */
export function severityOf(property: string): number {
  return PATTERN_SEVERITY[property] ?? DEFAULT_PATTERN_SEVERITY
}

/** One property's value on one screen, and the element it was read from. */
export interface ProfileValue {
  property: string
  kind: ProfileKind
  selector: string
  /** Exactly as the extraction recorded it. Never reworded. */
  value: string
}

/** Every property Drift reads off one screen, in the order they are declared. */
export type ScreenProfile = ProfileValue[]

/** One screen's profile, tied to the screen it came from. */
export interface ProfiledScreen {
  screenId: string
  route: string
  profile: ScreenProfile
}

export interface ProfileInput {
  signature: Signature
  computedStyles: ComputedStyles
  text: ScreenText
}

/**
 * The profile of one screen. A property whose element the screen does not have
 * is simply absent: a screen with no heading is not a screen with a wrong
 * heading.
 */
export function buildProfile(input: ProfileInput): ScreenProfile {
  const cta = terminalActionSelector(input.signature, input.computedStyles)
  const heading = firstHeadingSelector(input.computedStyles)

  const anchors: Record<string, string | null> = {
    cta,
    heading,
    // Only when the screen has both, so that the container being compared is
    // the one holding the same two things on every screen of the family.
    content:
      cta && heading ? contentContainerSelector(input.computedStyles, [heading, cta]) : null,
  }

  const values: ScreenProfile = []
  for (const property of PROFILE_PROPERTIES) {
    const selector = anchors[property.property.split(".")[0] ?? ""] ?? null
    if (!selector) continue

    const value =
      property.kind === "copy"
        ? resolveLabel(input.text, selector)
        : property.kind === "derived"
          ? deriveValue(property.property, input.text, selector)
          : readStyle(input.computedStyles, selector, property.styleProperty)

    if (value === null || value.length === 0) continue
    if (property.absentValues?.includes(value)) continue

    values.push({ property: property.property, kind: property.kind, selector, value })
  }

  return values
}

/** The value one profile holds for a property, or null when it holds none. */
export function profileValue(profile: ScreenProfile, property: string): ProfileValue | null {
  return profile.find((entry) => entry.property === property) ?? null
}

/**
 * The screen's terminal action: the last action in reading order that does not
 * look like every other action around it.
 *
 * Reading order alone is not enough. A screen asking a question offers several
 * answers, and the last one is the bottom answer, not a call to action: taking
 * "Married a while" as this screen's action and comparing it against another
 * screen's "Continue" compares two things that are not the same kind of thing.
 * What separates them is that the answers are peers, drawn identically, while a
 * call to action is the one element on the screen drawn like itself.
 *
 * So actions are grouped by how they are painted, and only an action alone in
 * its group can be the terminal one. A screen offering nothing but peers has no
 * terminal action and simply holds no `cta` values, the same way a screen with
 * no heading holds no heading values.
 *
 * A heuristic, and a stated one. What matters is that it is deterministic: the
 * same screen always yields the same anchor, so two screens are compared on the
 * same element rather than on whichever element a model happened to look at.
 */
export function terminalActionSelector(
  signature: Signature,
  computedStyles: ComputedStyles,
): string | null {
  const actions = signature.interactive.filter((element) => ACTION_TAGS.includes(element.tag))
  if (actions.length === 0) return null

  const appearance = (selector: string): string => {
    const styles = computedStyles[selector]?.styles
    if (!styles) return "unrecorded"
    return [styles["background-color"], styles["border-radius"], styles["font-size"]].join("|")
  }

  const peers = new Map<string, number>()
  for (const action of actions) {
    const key = appearance(action.selector)
    peers.set(key, (peers.get(key) ?? 0) + 1)
  }

  const alone = actions.filter((action) => peers.get(appearance(action.selector)) === 1)
  return alone[alone.length - 1]?.selector ?? null
}

/**
 * The container the screen's content sits in: the smallest recorded element
 * whose box surrounds every anchor given to it.
 *
 * Found by geometry rather than by walking the selectors, and the reason is
 * that a selector is anchored at the nearest stable ancestor, so an element
 * carrying its own `data-testid` has a selector that says nothing about where
 * it sits. A heading at `[data-testid="step"] > h1` and a button at
 * `[data-testid="next"]` are siblings in the page and strangers in their
 * names. Their boxes still agree on what encloses them.
 *
 * Smallest wins, so a tight wrapper is preferred to the full-page one it sits
 * inside. Ties break on the selector, the same way `firstHeadingSelector`
 * breaks its own, so the same screen always yields the same container. The
 * anchors themselves are never their own container, and `body` is never one
 * either: it is the page, and every screen has exactly one, so a convention
 * stated over it would say nothing about how this family arranges anything.
 *
 * Null when any anchor has no recorded box, or when nothing encloses them all.
 */
export function contentContainerSelector(
  computedStyles: ComputedStyles,
  contained: readonly string[],
): string | null {
  if (contained.length === 0) return null

  const boxes: BoundingBox[] = []
  for (const selector of contained) {
    const box = computedStyles[selector]?.box
    if (!box) return null
    boxes.push(box)
  }

  let best: { selector: string; area: number } | null = null

  for (const [selector, element] of Object.entries(computedStyles)) {
    if (selector === "body" || contained.includes(selector)) continue
    if (!boxes.every((box) => surrounds(element.box, box))) continue

    const area = element.box.width * element.box.height
    if (!best || area < best.area || (area === best.area && selector < best.selector)) {
      best = { selector, area }
    }
  }

  return best?.selector ?? null
}

/** Whether the outer box encloses the inner one. Touching edges still enclose. */
function surrounds(outer: BoundingBox, inner: BoundingBox): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  )
}

/** The screen's first heading, top to bottom. Ties break on the selector. */
export function firstHeadingSelector(computedStyles: ComputedStyles): string | null {
  let best: { selector: string; y: number; x: number } | null = null

  for (const [selector, element] of Object.entries(computedStyles)) {
    if (!HEADING_TAGS.includes(element.tag)) continue

    const candidate = { selector, y: element.box.y, x: element.box.x }
    if (
      !best ||
      candidate.y < best.y ||
      (candidate.y === best.y && candidate.x < best.x) ||
      (candidate.y === best.y && candidate.x === best.x && candidate.selector < best.selector)
    ) {
      best = candidate
    }
  }

  return best?.selector ?? null
}

/**
 * An element's visible label: its own text where it has some, and otherwise
 * the text of everything under it, which is how a button wrapping a span still
 * reads as the thing it says. The same resolution the signature uses, and the
 * same one the reconciliation gate uses, so a label read for a candidate and
 * the label the gate re-reads are the same string by construction.
 */
export function resolveLabel(text: ScreenText, selector: string): string {
  const own = text[selector]
  if (own && own.length > 0) return truncate(own)

  const prefix = `${selector} > `
  const parts: string[] = []
  for (const [key, value] of Object.entries(text)) {
    if (key.startsWith(prefix) && value.length > 0) parts.push(value)
  }

  return truncate(parts.join(" ").replace(/\s+/g, " ").trim())
}

/**
 * A derived property's value, worked out from the record rather than looked up
 * in it. Exported because the reconciliation gate verifies a derived value by
 * calling this again and comparing, which is what keeps such a value the
 * record's rather than the model's.
 */
export function deriveValue(
  property: string,
  text: ScreenText,
  selector: string,
): string | null {
  const label = resolveLabel(text, selector)
  if (label.length === 0) return null

  if (property === "cta.voice") return labelVoice(label)
  if (property === "heading.tone") return copyTone(label)
  return null
}

function readStyle(
  computedStyles: ComputedStyles,
  selector: string,
  styleProperty: StyleProperty | null,
): string | null {
  if (!styleProperty) return null
  const element = computedStyles[selector]
  if (!element) return null

  const value = element.styles[styleProperty]
  return value && value.length > 0 ? value.trim() : null
}

function truncate(value: string): string {
  return value.length <= MAX_LABEL_LENGTH ? value : `${value.slice(0, MAX_LABEL_LENGTH - 1)}…`
}
