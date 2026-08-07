/**
 * How one value is spelled in source.
 *
 * Chromium reports a computed colour as `rgb(255, 0, 0)` and a computed length
 * as `18px`. A repo writes the same colour as `#FF0000` and the same length as
 * `1.125rem`. A mechanical patch replaces a literal character for character, so
 * it has to know every way the value it is looking for can be written down.
 *
 * Every spelling here resolves back to exactly the same value. Nothing on this
 * list is a near miss, an approximation, or a guess about what the author meant:
 * a spelling that cannot be produced exactly is not produced at all.
 */

import { canonicalColor, parseColor, type Rgba } from "../analysis/color"
import { parseLengthPx, ROOT_FONT_SIZE_PX } from "../analysis/length"
import type { TokenGroup } from "../analysis/tokens"

/** Groups whose values are lengths rather than colours. */
const LENGTH_GROUPS: readonly TokenGroup[] = ["fontSize", "spacing", "radius"]

/**
 * Every spelling of a value that could appear in source, most likely first and
 * with no duplicates. An unreadable value yields only itself, which means a
 * patch is planned against the exact string or not at all.
 */
export function sourceSpellings(value: string, group: TokenGroup | null): string[] {
  const trimmed = value.trim()
  if (trimmed.length === 0) return []

  const spellings =
    group === "color"
      ? colorSpellings(trimmed)
      : group !== null && LENGTH_GROUPS.includes(group)
        ? lengthSpellings(trimmed)
        : [trimmed]

  return unique([trimmed, ...spellings])
}

/** Hex, `rgb()`, and `rgba()` spellings of one colour. */
export function colorSpellings(value: string): string[] {
  const color = parseColor(value)
  if (!color) return [value]

  const r = byte(color.r)
  const g = byte(color.g)
  const b = byte(color.b)
  const opaque = color.a >= 1

  const hex = `#${pair(r)}${pair(g)}${pair(b)}`
  const spellings = opaque
    ? [hex, hex.toUpperCase(), ...shortHex(r, g, b), ...functionSpellings("rgb", [r, g, b])]
    : [
        `${hex}${pair(Math.round(color.a * 255))}`,
        `${hex.toUpperCase()}${pair(Math.round(color.a * 255)).toUpperCase()}`,
        ...functionSpellings("rgba", [r, g, b, trimNumber(round(color.a, 3))]),
      ]

  return unique([...spellings, canonicalColor(color)])
}

/** `px`, `rem`, and `em` spellings of one length. */
export function lengthSpellings(value: string): string[] {
  const px = parseLengthPx(value)
  if (px === null) return [value]

  const spellings = [`${trimNumber(round(px, 4))}px`]

  // A rem spelling is only offered when it lands exactly on the root size. An
  // 18px value is 1.125rem and is offered; a 17px value is not 1.0625rem to
  // anyone reading the file, so it is left alone.
  const rem = round(px / ROOT_FONT_SIZE_PX, 6)
  if (Math.abs(rem * ROOT_FONT_SIZE_PX - px) < 1e-9) {
    spellings.push(`${trimNumber(rem)}rem`, `${trimNumber(rem)}em`)
  }

  // No bare-number spelling on purpose. A `0` or an `8` in a source file is
  // not readable as a length without knowing what surrounds it, and a patch
  // that replaces every standalone 8 in a repo is not a mechanical patch.

  return unique(spellings)
}

/** The scale a property answers to, for a value spelling. Null when there is none. */
export function valueGroupOf(property: string): TokenGroup | null {
  const name = property.toLowerCase()

  if (name.includes("color") || name.includes("colour") || name.endsWith(".fill")) return "color"
  if (name.endsWith("font-size") || name.endsWith(".size")) return "fontSize"
  if (name.endsWith("border-radius") || name.endsWith(".radius")) return "radius"
  if (name.endsWith("margin") || name.endsWith("padding") || name.endsWith(".spacing")) {
    return "spacing"
  }
  if (name.endsWith("font-weight") || name.endsWith(".weight")) return "fontWeight"

  return null
}

/** Both whitespace conventions of a CSS function call, legacy and modern. */
function functionSpellings(name: string, args: (string | number)[]): string[] {
  const parts = args.map(String)
  return [
    `${name}(${parts.join(", ")})`,
    `${name}(${parts.join(",")})`,
    `${name}(${parts.join(" ")})`,
  ]
}

/** The three-digit form, when every channel repeats its digit. */
function shortHex(r: number, g: number, b: number): string[] {
  const collapsible = [r, g, b].every((channel) => channel % 17 === 0)
  if (!collapsible) return []

  const digit = (channel: number): string => (channel / 17).toString(16)
  const short = `#${digit(r)}${digit(g)}${digit(b)}`
  return [short, short.toUpperCase()]
}

function byte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)))
}

function pair(value: number): string {
  return byte(value).toString(16).padStart(2, "0")
}

function round(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** `1.5` stays `1.5`, `1.0` becomes `1`. */
function trimNumber(value: number): string {
  return String(value)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))]
}
