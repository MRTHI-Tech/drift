/**
 * Token diffing: every resolved value on a screen, checked against the scales
 * the watched repo declares. Deterministic, no model call (AGENTS.md section 4).
 * A value that is not on a scale becomes a candidate carrying the element it
 * was seen on, the property, the value, and the token it sits nearest to.
 */

import { STYLE_PROPERTIES, type StyleProperty } from "../constants"
import type { ComputedStyles } from "../types"
import { colorDistance, isFullyTransparent, parseColor, sameColor } from "./color"
import { parseLengthPx, sameLength, splitShorthand } from "./length"
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
 * colour and four lengths. Both are pattern-drift questions, so they wait for
 * the judgment phase rather than being guessed at here.
 */
export const UNDIFFED_PROPERTIES = STYLE_PROPERTIES.filter(
  (property) => !(property in PROPERTY_GROUPS),
)

/** Properties whose value is a list of decisions rather than one. */
const SHORTHAND_PROPERTIES: readonly StyleProperty[] = ["margin", "padding", "border-radius"]

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

  return nearest
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

  return nearest
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
