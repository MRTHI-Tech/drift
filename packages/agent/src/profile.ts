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

import { HEADING_TAGS, type ComputedStyles, type ScreenText, type Signature, type StyleProperty } from "@drift/core"

import { DEFAULT_PATTERN_SEVERITY, PATTERN_SEVERITY } from "./constants"

/** Where a property's value is read from, and therefore where it is verified. */
export type ProfileKind = "style" | "copy"

/** One property a convention can be stated over. */
export interface ProfileProperty {
  /** The dotted name stored on a convention and a finding, for example `cta.label`. */
  property: string
  kind: ProfileKind
  /** The recorded CSS property a style value is read from. Null for copy. */
  styleProperty: StyleProperty | null
  /** How a person reads the property, for the log and the dashboard. */
  reads: string
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
  { property: "cta.size", kind: "style", styleProperty: "font-size", reads: "last action type size" },
  { property: "cta.radius", kind: "style", styleProperty: "border-radius", reads: "last action corner radius" },
  { property: "heading.size", kind: "style", styleProperty: "font-size", reads: "first heading type size" },
  { property: "heading.weight", kind: "style", styleProperty: "font-weight", reads: "first heading type weight" },
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
  const anchors = {
    cta: terminalActionSelector(input.signature),
    heading: firstHeadingSelector(input.computedStyles),
  }

  const values: ScreenProfile = []
  for (const property of PROFILE_PROPERTIES) {
    const selector = property.property.startsWith("cta.") ? anchors.cta : anchors.heading
    if (!selector) continue

    const value =
      property.kind === "copy"
        ? resolveLabel(input.text, selector)
        : readStyle(input.computedStyles, selector, property.styleProperty)

    if (value === null || value.length === 0) continue
    values.push({ property: property.property, kind: property.kind, selector, value })
  }

  return values
}

/** The value one profile holds for a property, or null when it holds none. */
export function profileValue(profile: ScreenProfile, property: string): ProfileValue | null {
  return profile.find((entry) => entry.property === property) ?? null
}

/**
 * The screen's terminal action: the last interactive element in reading order,
 * which is the bottom-most and, among elements on the same line, the
 * right-most. On a step with `Back` beside `Continue` that is `Continue`, and
 * on a step with one full-width button it is that button.
 *
 * A heuristic, and a stated one. It is deterministic, which is what matters:
 * the same screen always yields the same anchor, so two screens are compared
 * on the same element rather than on whichever element a model looked at.
 */
export function terminalActionSelector(signature: Signature): string | null {
  const actions = signature.interactive.filter((element) => ACTION_TAGS.includes(element.tag))
  const chosen = actions[actions.length - 1] ?? signature.interactive[signature.interactive.length - 1]
  return chosen?.selector ?? null
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
