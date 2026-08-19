/**
 * Token diffing: every resolved value on a screen, checked against the scales
 * the watched repo declares. Deterministic, no model call (AGENTS.md section 4).
 * A value that is not on a scale becomes a candidate carrying the element it
 * was seen on, the property, the value, and the token it sits nearest to.
 */

import { STYLE_PROPERTIES, type StyleProperty } from "../constants"
import type { ComputedStyles, ElementStyles } from "../types"
import { colorDistance, isFullyTransparent, parseColor, sameColor } from "./color"
import { parseLengthPx, ROOT_FONT_SIZE_PX, sameLength, splitShorthand } from "./length"
import { parseFontWeight, type Token, type TokenGroup, type TokenSet } from "./tokens"

/** Which scale each recorded property is answerable to. */
export const PROPERTY_GROUPS = {
  color: "color",
  "background-color": "color",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  margin: "spacing",
  padding: "spacing",
  "border-radius": "radius",
} as const satisfies Partial<Record<StyleProperty, TokenGroup>>

/**
 * Recorded properties this phase does not diff. `line-height` is only readable
 * against the font size it belongs to, and `box-shadow` is a composite of a
 * colour and four lengths. `display`, `gap` and `max-width` describe how a
 * container is arranged, and a container is arranged correctly or not relative
 * to its siblings rather than relative to a token: a screen laid out as a grid
 * where its family uses flex has not used the wrong value, it has used a
 * different one. All of them are pattern-drift questions, so they wait for the
 * judgment phase rather than being guessed at here.
 */
export const UNDIFFED_PROPERTIES = STYLE_PROPERTIES.filter(
  (property) => !(property in PROPERTY_GROUPS),
)

/** Properties whose value is a list of decisions rather than one. */
const SHORTHAND_PROPERTIES: readonly StyleProperty[] = ["margin", "padding", "border-radius"]

/**
 * Properties that inherit, so every element reports one whether or not anybody
 * set it. A paragraph inside a container reports the container's colour as its
 * own, and the deepest child of a page reports the root's font size. Diffing
 * those as though each element had chosen them turns one unstyled root into a
 * finding on every screen it appears on, cited at the element least likely to
 * have authored it.
 *
 * So an inherited property is only answerable to the scale where it changed:
 * on the element that moved it away from what it would otherwise have been.
 * Everything below that element is reporting the same decision, and the run
 * already states it once (AGENTS.md section 2).
 */
const INHERITED_PROPERTIES: readonly StyleProperty[] = ["color", "font-size", "font-weight"]

/**
 * What each inherited property is before anything sets it. The root of a
 * capture has no recorded parent to have differed from, so this is the only
 * thing that separates "the product chose black" from "nobody chose anything
 * and the browser filled it in".
 */
const INITIAL_VALUES: Partial<Record<StyleProperty, string>> = {
  color: "rgb(0, 0, 0)",
  "font-size": `${ROOT_FONT_SIZE_PX}px`,
  "font-weight": "400",
}

/**
 * How far an off-scale value may sit from a token before naming that token
 * says nothing.
 *
 * Nearest is always true and not always useful. A 52px radius on a scale whose
 * largest step is 26px does have a nearest token, but calling it the nearest
 * invites snapping a value to something twice its size, which is a redesign
 * rather than a correction. Past these distances the finding still stands, and
 * says the value is on no scale rather than naming one.
 *
 * Colours are OKLab distance, where `colorDistance` puts a different colour
 * entirely past 0.3. Lengths are pixels, at roughly one step of a scale.
 * Weights are steps of 100.
 */
export const MAX_NAMEABLE_DISTANCE: Record<TokenGroup, number> = {
  color: 0.3,
  fontSize: 4,
  fontWeight: 200,
  spacing: 8,
  radius: 8,
}

/**
 * How loud a token finding is, by what a person notices. A wrong colour reads
 * from across the room, a wrong radius does not. Fixed per group so two runs
 * of the same screen always agree.
 */
const SEVERITY: Record<TokenGroup, number> = {
  color: 3,
  fontSize: 2,
  fontWeight: 2,
  spacing: 1,
  radius: 1,
}

/** The token an off-scale value sits closest to. */
export interface NearestToken {
  name: string
  value: string
  /** OKLab distance for a colour, pixels for a length, steps for a weight. */
  distance: number
}

/** One off-scale value, ready to be written as a finding. */
export interface TokenDriftCandidate {
  /** Stable selector of the first element in document order that shows it. */
  selector: string
  property: StyleProperty
  group: TokenGroup
  /** The property's value exactly as the extractor recorded it. */
  declaredValue: string
  /** The part of that value that is off the scale. */
  observedValue: string
  nearestToken: NearestToken | null
  severity: number
}

/**
 * Every off-scale value on one screen, in document order.
 *
 * One candidate per property and value: a colour hardcoded on a container is
 * inherited by everything under it, and forty elements reporting it is one
 * decision, not forty. The first element that shows it is the one cited, which
 * is also the topmost, and the dedupe key is scoped the same way
 * (AGENTS.md section 2).
 */
export function diffScreenTokens(
  computedStyles: ComputedStyles,
  tokens: TokenSet,
): TokenDriftCandidate[] {
  const candidates: TokenDriftCandidate[] = []
  const seen = new Set<string>()

  for (const [selector, element] of Object.entries(computedStyles)) {
    for (const [property, group] of Object.entries(PROPERTY_GROUPS) as [
      StyleProperty,
      TokenGroup,
    ][]) {
      // No scale to answer to means no claim to make.
      if (tokens[group].length === 0) continue

      const declaredValue = element.styles[property]
      if (!declaredValue) continue

      // An inherited value this element did not set belongs to whichever
      // ancestor did, and is answered for there.
      if (!wasSetHere(computedStyles, selector, property, group, declaredValue)) {
        continue
      }

      const parts = SHORTHAND_PROPERTIES.includes(property)
        ? splitShorthand(declaredValue)
        : [declaredValue.trim()]

      for (const part of parts) {
        const nearest = compare(part, group, tokens[group])
        if (nearest === "conforms" || nearest === "unreadable") continue

        const key = `${property}|${part}`
        if (seen.has(key)) continue
        seen.add(key)

        candidates.push({
          selector,
          property,
          group,
          declaredValue,
          observedValue: part,
          nearestToken: nearest,
          severity: SEVERITY[group],
        })
      }
    }
  }

  return candidates
}

/**
 * Whether this element is where an inherited value was actually set. A property
 * that does not inherit is always this element's own decision.
 */
function wasSetHere(
  computedStyles: ComputedStyles,
  selector: string,
  property: StyleProperty,
  group: TokenGroup,
  declaredValue: string,
): boolean {
  if (!INHERITED_PROPERTIES.includes(property)) return true

  const ancestor = nearestRecordedAncestor(computedStyles, selector)
  if (ancestor) {
    const inherited = ancestor.styles[property]
    return !inherited || !sameValue(group, declaredValue, inherited)
  }

  // Nothing above it was recorded, so this is the top of the capture and there
  // is no parent value it could have differed from. All that can be said is
  // whether anything moved it off the value it would have had anyway.
  const initial = INITIAL_VALUES[property]
  return initial === undefined || !sameValue(group, declaredValue, initial)
}

/**
 * The closest ancestor the extraction kept. Not necessarily the DOM parent: the
 * extractor drops elements to stay inside its size budget, and inheritance
 * passes straight through whatever it dropped, so the nearest ancestor that was
 * kept still carries the value this element would have inherited.
 */
function nearestRecordedAncestor(
  computedStyles: ComputedStyles,
  selector: string,
): ElementStyles | null {
  let path = selector

  for (;;) {
    const cut = path.lastIndexOf(" > ")
    if (cut < 0) return null

    path = path.slice(0, cut)
    const ancestor = computedStyles[path]
    if (ancestor) return ancestor
  }
}

/** Whether two spellings of one property mean the same thing. */
function sameValue(group: TokenGroup, left: string, right: string): boolean {
  if (group === "color") {
    const a = parseColor(left)
    const b = parseColor(right)
    return a !== null && b !== null && sameColor(a, b)
  }

  const read = group === "fontWeight" ? parseFontWeight : parseLengthPx
  const a = read(left)
  const b = read(right)
  if (a === null || b === null) return left.trim() === right.trim()

  return group === "fontWeight" ? a === b : sameLength(a, b)
}

/** The nearest token, or null when it is too far away to mean anything. */
function nameable(nearest: NearestToken | null, group: TokenGroup): NearestToken | null {
  if (!nearest) return null
  return nearest.distance <= MAX_NAMEABLE_DISTANCE[group] ? nearest : null
}

/**
 * Whether one value is on the scale, off it, or not something Drift reads.
 * `auto`, a percentage, and a `calc()` are all unreadable, and an unreadable
 * value is never called drift.
 */
function compare(
  value: string,
  group: TokenGroup,
  scale: Token[],
): NearestToken | null | "conforms" | "unreadable" {
  return group === "color" ? compareColor(value, scale) : compareNumber(value, group, scale)
}

function compareColor(
  value: string,
  scale: Token[],
): NearestToken | null | "conforms" | "unreadable" {
  const observed = parseColor(value)
  if (!observed) return "unreadable"
  // Nothing is showing, so no token could be expected of it.
  if (isFullyTransparent(observed)) return "unreadable"

  let nearest: NearestToken | null = null

  for (const token of scale) {
    const candidate = parseColor(token.value)
    if (!candidate) continue
    if (sameColor(observed, candidate)) return "conforms"

    const distance = colorDistance(observed, candidate)
    if (!nearest || distance < nearest.distance) {
      nearest = { name: token.name, value: token.value, distance }
    }
  }

  return nameable(nearest, "color")
}

function compareNumber(
  value: string,
  group: TokenGroup,
  scale: Token[],
): NearestToken | null | "conforms" | "unreadable" {
  const read = group === "fontWeight" ? parseFontWeight : parseLengthPx
  const observed = read(value)
  if (observed === null) return "unreadable"
  // Zero is always on any scale: it is the absence of the thing.
  if (group !== "fontWeight" && observed === 0) return "conforms"

  // A negative length is an overlap: something pulled deliberately over the
  // thing before it. A spacing scale of positive steps has no answer to it, and
  // reporting that -20px missed a 4px step describes nothing anybody did.
  if (group !== "fontWeight" && observed < 0 && !hasNegative(scale, read)) {
    return "unreadable"
  }

  let nearest: NearestToken | null = null

  for (const token of scale) {
    const candidate = read(token.value)
    if (candidate === null) continue
    if (group === "fontWeight" ? candidate === observed : sameLength(observed, candidate)) {
      return "conforms"
    }

    const distance = Math.abs(observed - candidate)
    if (!nearest || distance < nearest.distance) {
      nearest = { name: token.name, value: token.value, distance }
    }
  }

  return nameable(nearest, group)
}

/** Whether a scale has any step below zero to answer a negative value with. */
function hasNegative(
  scale: readonly Token[],
  read: (value: string) => number | null,
): boolean {
  return scale.some((token) => {
    const value = read(token.value)
    return value !== null && value < 0
  })
}

/**
 * Whether a value really is recorded for a selector's property, allowing for a
 * shorthand carrying several. This is what the reconciliation gate in the
 * judgment phase checks a model-proposed finding against (AGENTS.md section 3):
 * the record is the only source of observed values.
 */
export function valueAppearsIn(
  computedStyles: ComputedStyles,
  selector: string,
  property: string,
  observedValue: string,
): boolean {
  const element = computedStyles[selector]
  if (!element) return false
  if (!isStyleProperty(property)) return false

  const declared = element.styles[property]
  if (!declared) return false

  const wanted = observedValue.trim()
  return declared.trim() === wanted || splitShorthand(declared).includes(wanted)
}

function isStyleProperty(property: string): property is StyleProperty {
  return (STYLE_PROPERTIES as readonly string[]).includes(property)
}
