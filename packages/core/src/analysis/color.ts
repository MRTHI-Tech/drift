/**
 * Colour parsing and comparison, deterministic and dependency-free.
 *
 * Two colours have to compare equal across the gap between how a token file
 * writes a colour (`#7C3AED`, `oklch(0.6 0.2 300)`) and how Chromium reports
 * the same colour back (`rgb(124, 58, 237)`). Everything is therefore parsed
 * into sRGB, and "how far apart" is measured in OKLab, which is close enough to
 * perceptual distance that a near-miss reads as a near-miss.
 */

/** A parsed colour. `r`, `g`, `b` are sRGB 0 to 255; `a` is 0 to 1. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/**
 * CSS colour keywords Drift resolves. The extractor never emits a keyword,
 * Chromium resolves those, but a hand-written token file may use one. Anything
 * outside this table parses as null and is left alone rather than guessed at.
 */
const KEYWORDS: Record<string, string> = {
  transparent: "#00000000",
  black: "#000000",
  silver: "#c0c0c0",
  gray: "#808080",
  grey: "#808080",
  white: "#ffffff",
  maroon: "#800000",
  red: "#ff0000",
  purple: "#800080",
  fuchsia: "#ff00ff",
  magenta: "#ff00ff",
  green: "#008000",
  lime: "#00ff00",
  olive: "#808000",
  yellow: "#ffff00",
  navy: "#000080",
  blue: "#0000ff",
  teal: "#008080",
  aqua: "#00ffff",
  cyan: "#00ffff",
  orange: "#ffa500",
}

/** Parses any colour syntax Drift understands. Returns null for the rest. */
export function parseColor(input: string): Rgba | null {
  const value = input.trim().toLowerCase()
  if (value.length === 0) return null

  const keyword = KEYWORDS[value]
  if (keyword) return parseHex(keyword)

  if (value.startsWith("#")) return parseHex(value)

  const call = parseCall(value)
  if (!call) return null

  switch (call.name) {
    case "rgb":
    case "rgba":
      return fromRgb(call.args)
    case "hsl":
    case "hsla":
      return fromHsl(call.args)
    case "oklch":
      return fromOklch(call.args)
    case "oklab":
      return fromOklab(call.args)
    case "color":
      return fromColorFunction(call.args)
    default:
      return null
  }
}

/**
 * One spelling per colour, so equality is a string comparison. Alpha is
 * dropped when the colour is opaque, matching how Chromium reports it.
 */
export function canonicalColor(color: Rgba): string {
  const r = clampByte(color.r)
  const g = clampByte(color.g)
  const b = clampByte(color.b)
  const a = round(clamp(color.a, 0, 1), 3)
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`
}

/** True when both colours resolve to the same canonical sRGB value. */
export function sameColor(left: Rgba, right: Rgba): boolean {
  return canonicalColor(left) === canonicalColor(right)
}

/**
 * Perceptual distance in OKLab, with a difference in alpha counted as its own
 * axis so `#000` and a transparent black are not called identical. Roughly:
 * under 0.02 is a value a person would struggle to tell apart, over 0.3 is a
 * different colour entirely.
 */
export function colorDistance(left: Rgba, right: Rgba): number {
  const a = toOklab(left)
  const b = toOklab(right)
  const dl = a.l - b.l
  const da = a.a - b.a
  const db = a.b - b.b
  const dAlpha = clamp(left.a, 0, 1) - clamp(right.a, 0, 1)
  return round(Math.sqrt(dl * dl + da * da + db * db + dAlpha * dAlpha), 6)
}

/** True when a colour is invisible, so no token could be expected of it. */
export function isFullyTransparent(color: Rgba): boolean {
  return clamp(color.a, 0, 1) === 0
}

function parseHex(value: string): Rgba | null {
  const digits = value.startsWith("#") ? value.slice(1) : value
  if (!/^[0-9a-f]+$/.test(digits)) return null

  const expand = (part: string): number => Number.parseInt(part.repeat(2), 16)

  switch (digits.length) {
    case 3:
      return rgba(expand(digits[0]!), expand(digits[1]!), expand(digits[2]!), 1)
    case 4:
      return rgba(
        expand(digits[0]!),
        expand(digits[1]!),
        expand(digits[2]!),
        expand(digits[3]!) / 255,
      )
    case 6:
      return rgba(hexPair(digits, 0), hexPair(digits, 2), hexPair(digits, 4), 1)
    case 8:
      return rgba(
        hexPair(digits, 0),
        hexPair(digits, 2),
        hexPair(digits, 4),
        hexPair(digits, 6) / 255,
      )
    default:
      return null
  }
}

function hexPair(digits: string, at: number): number {
  return Number.parseInt(digits.slice(at, at + 2), 16)
}

interface ColorCall {
  name: string
  args: string[]
}

/**
 * Splits `name(a, b, c / d)` into its parts. Both the legacy comma syntax and
 * the modern space syntax reach this the same way: commas and slashes become
 * spaces, so the argument list is whatever is left.
 */
function parseCall(value: string): ColorCall | null {
  const open = value.indexOf("(")
  if (open <= 0 || !value.endsWith(")")) return null

  const name = value.slice(0, open).trim()
  const body = value.slice(open + 1, -1)
  const args = body
    .replace(/[,/]/g, " ")
    .split(/\s+/)
    .filter((part) => part.length > 0)

  return args.length === 0 ? null : { name, args }
}

function fromRgb(args: string[]): Rgba | null {
  if (args.length < 3) return null
  const r = channel(args[0]!, 255)
  const g = channel(args[1]!, 255)
  const b = channel(args[2]!, 255)
  const a = args.length > 3 ? alpha(args[3]!) : 1
  if (r === null || g === null || b === null || a === null) return null
  return rgba(r, g, b, a)
}

function fromHsl(args: string[]): Rgba | null {
  if (args.length < 3) return null
  const h = angle(args[0]!)
  const s = percent(args[1]!)
  const l = percent(args[2]!)
  const a = args.length > 3 ? alpha(args[3]!) : 1
  if (h === null || s === null || l === null || a === null) return null

  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r, g, b] = hueSegment(hp, c, x)
  const m = l - c / 2

  return rgba((r + m) * 255, (g + m) * 255, (b + m) * 255, a)
}

function hueSegment(hp: number, c: number, x: number): [number, number, number] {
  if (hp < 1) return [c, x, 0]
  if (hp < 2) return [x, c, 0]
  if (hp < 3) return [0, c, x]
  if (hp < 4) return [0, x, c]
  if (hp < 5) return [x, 0, c]
  return [c, 0, x]
}

function fromOklch(args: string[]): Rgba | null {
  if (args.length < 3) return null
  const l = number(args[0]!, 1)
  const c = number(args[1]!, 0.4)
  const h = angle(args[2]!)
  const a = args.length > 3 ? alpha(args[3]!) : 1
  if (l === null || c === null || h === null || a === null) return null

  const radians = (h * Math.PI) / 180
  return fromOklabValues(l, c * Math.cos(radians), c * Math.sin(radians), a)
}

function fromOklab(args: string[]): Rgba | null {
  if (args.length < 3) return null
  const l = number(args[0]!, 1)
  const a = number(args[1]!, 0.4)
  const b = number(args[2]!, 0.4)
  const alphaValue = args.length > 3 ? alpha(args[3]!) : 1
  if (l === null || a === null || b === null || alphaValue === null) return null
  return fromOklabValues(l, a, b, alphaValue)
}

/** Only the sRGB space of `color()`. Wide-gamut spaces are left unparsed. */
function fromColorFunction(args: string[]): Rgba | null {
  const space = args[0]
  if (space !== "srgb" || args.length < 4) return null
  const r = number(args[1]!, 1)
  const g = number(args[2]!, 1)
  const b = number(args[3]!, 1)
  const a = args.length > 4 ? alpha(args[4]!) : 1
  if (r === null || g === null || b === null || a === null) return null
  return rgba(r * 255, g * 255, b * 255, a)
}

function channel(value: string, scale: number): number | null {
  if (value.endsWith("%")) {
    const fraction = percent(value)
    return fraction === null ? null : fraction * scale
  }
  return number(value, 1)
}

function alpha(value: string): number | null {
  if (value.endsWith("%")) return percent(value)
  const parsed = number(value, 1)
  return parsed === null ? null : clamp(parsed, 0, 1)
}

function percent(value: string): number | null {
  if (!value.endsWith("%")) {
    // A bare number is a 0-to-1 fraction in the modern syntax.
    const parsed = number(value, 1)
    return parsed === null ? null : parsed
  }
  const parsed = number(value.slice(0, -1), 1)
  return parsed === null ? null : parsed / 100
}

function angle(value: string): number | null {
  const stripped = value.replace(/deg$/, "")
  if (stripped.endsWith("turn")) {
    const turns = number(stripped.slice(0, -4), 1)
    return turns === null ? null : turns * 360
  }
  if (stripped.endsWith("rad")) {
    const radians = number(stripped.slice(0, -3), 1)
    return radians === null ? null : (radians * 180) / Math.PI
  }
  return number(stripped, 1)
}

/** A plain number, or a percentage read against `full`. */
function number(value: string, full: number): number | null {
  if (value === "none") return 0
  if (value.endsWith("%")) {
    const parsed = Number(value.slice(0, -1))
    return Number.isFinite(parsed) ? (parsed / 100) * full : null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function fromOklabValues(l: number, a: number, b: number, alphaValue: number): Rgba {
  const lp = l + 0.3963377774 * a + 0.2158037573 * b
  const mp = l - 0.1055613458 * a - 0.0638541728 * b
  const sp = l - 0.0894841775 * a - 1.291485548 * b

  const lc = lp * lp * lp
  const mc = mp * mp * mp
  const sc = sp * sp * sp

  const r = 4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc
  const g = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc
  const bl = -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc

  return rgba(encodeSrgb(r) * 255, encodeSrgb(g) * 255, encodeSrgb(bl) * 255, alphaValue)
}

interface Oklab {
  l: number
  a: number
  b: number
}

function toOklab(color: Rgba): Oklab {
  const r = decodeSrgb(clamp(color.r, 0, 255) / 255)
  const g = decodeSrgb(clamp(color.g, 0, 255) / 255)
  const b = decodeSrgb(clamp(color.b, 0, 255) / 255)

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

function decodeSrgb(value: number): number {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
}

function encodeSrgb(value: number): number {
  const clamped = clamp(value, 0, 1)
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055
}

function rgba(r: number, g: number, b: number, a: number): Rgba {
  return { r, g, b, a: clamp(a, 0, 1) }
}

function clampByte(value: number): number {
  return Math.round(clamp(value, 0, 255))
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function round(value: number, places: number): number {
  const factor = 10 ** places
  const rounded = Math.round(value * factor) / factor
  return rounded === 0 ? 0 : rounded
}
