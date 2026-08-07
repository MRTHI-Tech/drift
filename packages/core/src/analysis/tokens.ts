/**
 * The watched repo's design tokens, read out of the file its `drift.config.json`
 * points at (`tokenDefinitionsPath`, AGENTS.md section 2a).
 *
 * Two shapes are supported, because those are the two ways a token file is
 * actually written: a `tokens.json`, and a `theme.ts` that exports objects of
 * colours, a spacing scale, and a type scale. Neither is executed; the TypeScript
 * one is read as source (see `literal.ts`).
 */

import { canonicalColor, parseColor } from "./color"
import { parseLengthPx } from "./length"
import { parseModuleLiterals, type LiteralValue } from "./literal"

/** The kinds of token Drift compares a rendered screen against. */
export type TokenGroup = "color" | "spacing" | "fontSize" | "fontWeight" | "radius"

/** Every group, in the order they are reported. */
export const TOKEN_GROUPS = [
  "color",
  "spacing",
  "fontSize",
  "fontWeight",
  "radius",
] as const satisfies readonly TokenGroup[]

export interface Token {
  /** Dotted path the token is declared at, for example `colors.brand.500`. */
  name: string
  /** The value exactly as the token file writes it. */
  value: string
  group: TokenGroup
}

/** Every token a watched repo declares, grouped by what it can be compared to. */
export type TokenSet = Record<TokenGroup, Token[]>

/**
 * Keys a group is recognised by, lowercased. A token file nests its groups
 * differently every time, so the whole tree is searched for these rather than
 * one shape being demanded.
 */
const GROUP_KEYS: Record<TokenGroup, readonly string[]> = {
  color: ["colors", "color", "palette"],
  spacing: ["spacing", "space", "spaces"],
  fontSize: ["fontsize", "fontsizes", "typescale", "type", "text", "textsizes"],
  fontWeight: ["fontweight", "fontweights", "weights"],
  radius: ["radius", "radii", "borderradius", "borderradii", "rounded"],
}

/** How deep the search for a group goes before it gives up on a file. */
const MAX_DEPTH = 8

/** Most tokens one group contributes. A file past this is generated, not authored. */
const MAX_TOKENS_PER_GROUP = 500

/** Raised when a token file cannot be read at all. */
export class TokenDefinitionsError extends Error {
  override readonly name = "TokenDefinitionsError"
}

/** An empty set of every group. Diffing against it produces nothing. */
export function emptyTokenSet(): TokenSet {
  return { color: [], spacing: [], fontSize: [], fontWeight: [], radius: [] }
}

export function countTokens(tokens: TokenSet): number {
  return TOKEN_GROUPS.reduce((total, group) => total + tokens[group].length, 0)
}

/**
 * Reads a token file. The path decides how: `.json` is decoded, anything else
 * is read as module source. A file with no recognisable group parses to an
 * empty set rather than throwing, so a run still renders and still signs.
 */
export function parseTokenDefinitions(source: string, path: string): TokenSet {
  return path.toLowerCase().endsWith(".json")
    ? tokenSetFrom(decodeJson(source, path))
    : tokenSetFrom(parseModuleLiterals(source) as LiteralValue)
}

/** Builds a token set out of an already-decoded value. */
export function tokenSetFrom(value: unknown): TokenSet {
  const tokens = emptyTokenSet()
  search(value as LiteralValue, [], 0, tokens)

  for (const group of TOKEN_GROUPS) {
    tokens[group] = collapseAliases(dedupe(tokens[group]), group)
      .sort((left, right) => compareNames(left.name, right.name))
      .slice(0, MAX_TOKENS_PER_GROUP)
  }
  return tokens
}

/**
 * A font weight as a number. Chromium always reports one; a token file is
 * allowed the two keywords CSS gives a numeric meaning to.
 */
export function parseFontWeight(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null

  const text = value.trim().toLowerCase()
  if (text === "normal") return 400
  if (text === "bold") return 700

  const parsed = Number(text)
  return Number.isFinite(parsed) && text.length > 0 ? parsed : null
}

/** Walks the tree looking for a group key, then flattens whatever is under it. */
function search(value: LiteralValue, path: string[], depth: number, tokens: TokenSet): void {
  if (depth > MAX_DEPTH || !isRecord(value)) return

  for (const [key, child] of Object.entries(value)) {
    const group = groupFor(key)
    if (group) {
      flatten(child, [...path, key], group, tokens)
    } else {
      search(child, [...path, key], depth + 1, tokens)
    }
  }
}

function groupFor(key: string): TokenGroup | null {
  const normalized = key.toLowerCase().replace(/[-_]/g, "")
  for (const group of TOKEN_GROUPS) {
    if (GROUP_KEYS[group].includes(normalized)) return group
  }
  return null
}

function flatten(value: LiteralValue, path: string[], group: TokenGroup, tokens: TokenSet): void {
  if (path.length > MAX_DEPTH) return

  if (typeof value === "string" || typeof value === "number") {
    const token = toToken(path.join("."), String(value), group)
    if (token) tokens[group].push(token)
    return
  }

  if (Array.isArray(value)) {
    // A Tailwind type scale writes `base: ["1rem", { lineHeight: "1.5rem" }]`.
    // The size is the first entry; the rest describes it and is not a size.
    if (group === "fontSize") {
      const first = value[0]
      if (typeof first === "string" || typeof first === "number") {
        flatten(first, path, group, tokens)
        return
      }
    }
    value.forEach((item, index) => {
      flatten(item, [...path, String(index)], group, tokens)
    })
    return
  }

  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, [...path, key], group, tokens)
    }
  }
}

/** Keeps only values the group can actually be compared against. */
function toToken(name: string, value: string, group: TokenGroup): Token | null {
  const readable =
    group === "color"
      ? parseColor(value) !== null
      : group === "fontWeight"
        ? parseFontWeight(value) !== null
        : parseLengthPx(value) !== null

  return readable ? { name, value, group } : null
}

/** One token per name. A later declaration of the same name wins, as in a module. */
function dedupe(tokens: Token[]): Token[] {
  const byName = new Map<string, Token>()
  for (const token of tokens) byName.set(token.name, token)
  return [...byName.values()]
}

/**
 * One token per value. A theme file that both names its scales and re-exports
 * them as a default declares each value twice, and an alias declares a value a
 * second name. Either way the value is one token, and the shortest name for it
 * is the one a finding should cite.
 */
function collapseAliases(tokens: Token[], group: TokenGroup): Token[] {
  const byValue = new Map<string, Token>()

  for (const token of tokens) {
    const key = normalizedValue(token.value, group)
    if (key === null) continue

    const existing = byValue.get(key)
    if (!existing || preferredName(token.name, existing.name)) byValue.set(key, token)
  }

  return [...byValue.values()]
}

/** What two spellings of the same value have in common. */
function normalizedValue(value: string, group: TokenGroup): string | null {
  if (group === "color") {
    const color = parseColor(value)
    return color ? canonicalColor(color) : null
  }

  const number = group === "fontWeight" ? parseFontWeight(value) : parseLengthPx(value)
  return number === null ? null : String(number)
}

/** Shallower first, so `spacing.3` beats `theme.default.spacing.3`. */
function preferredName(candidate: string, current: string): boolean {
  const depth = candidate.split(".").length - current.split(".").length
  return depth === 0 ? compareNames(candidate, current) < 0 : depth < 0
}

/**
 * Names sort by their numeric parts where they have them, so `spacing.2` comes
 * before `spacing.10`. Ties in a nearest-token search break on this order, so
 * it has to be total and stable.
 */
function compareNames(left: string, right: string): number {
  const leftParts = left.split(".")
  const rightParts = right.split(".")

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const a = leftParts[index]
    const b = rightParts[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (a === b) continue

    const numberA = Number(a)
    const numberB = Number(b)
    if (Number.isFinite(numberA) && Number.isFinite(numberB)) return numberA - numberB
    return a < b ? -1 : 1
  }

  return 0
}

function decodeJson(source: string, path: string): unknown {
  try {
    return JSON.parse(source)
  } catch (cause) {
    throw new TokenDefinitionsError(`The token file at ${path} is not valid JSON`, { cause })
  }
}

function isRecord(value: LiteralValue): value is Record<string, LiteralValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
