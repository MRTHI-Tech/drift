/**
 * CSS lengths, resolved to pixels. Chromium always reports a computed length in
 * px; a token file usually writes rem. Both end up as one number here so a
 * scale can be compared against what rendered.
 */

/**
 * Root font size a rem is read against. Fixed rather than read off the page:
 * a token scale means the same thing whatever the user's browser is set to,
 * and a run has to be comparable to the run before it.
 */
export const ROOT_FONT_SIZE_PX = 16

/**
 * Lengths this close are the same length. Sub-pixel jitter is not drift.
 *
 * Half a pixel, because that is the point below which nothing is visible and
 * below which a browser's own arithmetic moves things anyway. A layout engine
 * that scales a type ramp reports 13.3333px for a 13.5px token, and a
 * device-pixel-ratio boundary rounds a 12px radius to 11.5px. Neither is a
 * decision anybody made, and reporting them as drift buries the values that
 * are.
 */
export const LENGTH_EPSILON_PX = 0.5

/**
 * Reads a single length in px. A bare number is read as px, which is how token
 * files that write `spacing: { 2: 8 }` mean it. Percentages, `auto`, `calc()`,
 * and anything else return null and are left alone.
 */
export function parseLengthPx(input: string | number): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null

  const value = input.trim().toLowerCase()
  if (value.length === 0) return null

  const match = /^(-?\d*\.?\d+)(px|rem|em|pt)?$/.exec(value)
  if (!match) return null

  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return null

  switch (match[2]) {
    case undefined:
    case "px":
      return amount
    case "rem":
    // An em inside a token file is authored against the root, same as a rem.
    case "em":
      return amount * ROOT_FONT_SIZE_PX
    case "pt":
      return (amount * 96) / 72
    default:
      return null
  }
}

/** True when two lengths are the same to within the epsilon. */
export function sameLength(left: number, right: number): boolean {
  return Math.abs(left - right) <= LENGTH_EPSILON_PX
}

/**
 * Splits a box shorthand into its parts. `margin: 0px 8px` is two decisions,
 * not one, and each is checked against the scale on its own. The `/` in a
 * `border-radius` separates two sets of radii, so it splits the same way.
 */
export function splitShorthand(value: string): string[] {
  return value
    .trim()
    .split(/[\s/]+/)
    .filter((part) => part.length > 0)
}
