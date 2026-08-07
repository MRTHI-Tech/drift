/**
 * A reader for the object literals in a hand-written `theme.ts`.
 *
 * Drift never executes a watched repo's code, so a token file is read rather
 * than imported. This handles the subset a token file is written in: exported
 * const objects and arrays of strings and numbers, shorthand properties,
 * spreads of things declared in the same file, trailing commas, comments, and
 * a trailing `as const`. Anything else in a value, a function call or a
 * computed key, drops that entry and leaves the rest of the file readable.
 */

export type LiteralValue =
  | string
  | number
  | boolean
  | null
  | LiteralValue[]
  | { [key: string]: LiteralValue }

/** Name of the entry an `export default` is collected under. */
export const DEFAULT_EXPORT = "default"

/**
 * Every top-level `const`, `let`, `var`, and `export default` in a module,
 * with the values that could be read. Declarations whose value is not a
 * literal are absent.
 */
export function parseModuleLiterals(source: string): Record<string, LiteralValue> {
  const text = stripComments(source)
  const raw = new Map<string, Node>()

  const declaration = /(?:^|[\s;}])(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g
  for (let match = declaration.exec(text); match; match = declaration.exec(text)) {
    const parsed = readValue(text, match.index + match[0].length)
    if (parsed) raw.set(match[1]!, parsed.node)
  }

  const defaultExport = /(?:^|[\s;}])export\s+default\b\s*/g
  for (let match = defaultExport.exec(text); match; match = defaultExport.exec(text)) {
    const parsed = readValue(text, match.index + match[0].length)
    if (parsed) raw.set(DEFAULT_EXPORT, parsed.node)
  }

  const resolved: Record<string, LiteralValue> = {}
  for (const [name, node] of raw) {
    const value = resolve(node, raw, new Set())
    if (value !== UNRESOLVED) resolved[name] = value
  }
  return resolved
}

/** A parsed value before identifier references have been followed. */
type Node =
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "array"; items: Node[] }
  | { kind: "object"; entries: ObjectEntry[] }
  | { kind: "ref"; name: string }

type ObjectEntry = { kind: "property"; key: string; value: Node } | { kind: "spread"; value: Node }

/** Sentinel for a value that could not be read, kept out of the result. */
const UNRESOLVED = Symbol("unresolved")

function resolve(
  node: Node,
  declarations: Map<string, Node>,
  seen: Set<string>,
): LiteralValue | typeof UNRESOLVED {
  switch (node.kind) {
    case "literal":
      return node.value

    case "ref": {
      const target = declarations.get(node.name)
      // A reference to something declared elsewhere, or to itself, is dropped
      // rather than followed anywhere it could loop.
      if (!target || seen.has(node.name)) return UNRESOLVED
      return resolve(target, declarations, new Set([...seen, node.name]))
    }

    case "array": {
      const items: LiteralValue[] = []
      for (const item of node.items) {
        const value = resolve(item, declarations, seen)
        if (value !== UNRESOLVED) items.push(value)
      }
      return items
    }

    case "object": {
      const result: Record<string, LiteralValue> = {}
      for (const entry of node.entries) {
        const value = resolve(entry.value, declarations, seen)
        if (value === UNRESOLVED) continue
        if (entry.kind === "property") {
          result[entry.key] = value
        } else if (isRecord(value)) {
          Object.assign(result, value)
        }
      }
      return result
    }
  }
}

interface Read {
  node: Node
  /** Index just past the value. */
  end: number
}

function readValue(text: string, from: number): Read | null {
  const at = skipSpace(text, from)
  const char = text[at]
  if (char === undefined) return null

  if (char === "{") return readObject(text, at)
  if (char === "[") return readArray(text, at)
  if (char === '"' || char === "'" || char === "`") return readString(text, at)
  if (char === "-" || char === "." || (char >= "0" && char <= "9")) return readNumber(text, at)

  const word = /^[A-Za-z_$][\w$]*/.exec(text.slice(at))
  if (!word) return null

  const name = word[0]
  const end = at + name.length
  if (name === "true") return { node: { kind: "literal", value: true }, end }
  if (name === "false") return { node: { kind: "literal", value: false }, end }
  if (name === "null" || name === "undefined") return { node: { kind: "literal", value: null }, end }

  // A bare identifier followed by anything callable is an expression, not a
  // value Drift can read without running the file.
  const next = text[skipSpace(text, end)]
  if (next === "(" || next === "." || next === "[") return null

  return { node: { kind: "ref", name }, end }
}

function readObject(text: string, from: number): Read | null {
  const entries: ObjectEntry[] = []
  let at = skipSpace(text, from + 1)

  while (at < text.length) {
    if (text[at] === "}") return { node: { kind: "object", entries }, end: at + 1 }

    if (text.startsWith("...", at)) {
      const spread = readValue(text, at + 3)
      if (!spread) return null
      entries.push({ kind: "spread", value: spread.node })
      at = spread.end
    } else {
      const entry = readEntry(text, at)
      if (!entry) return null
      if (entry.entry) entries.push(entry.entry)
      at = entry.end
    }

    at = skipSpace(text, at)
    if (text[at] === ",") at = skipSpace(text, at + 1)
  }

  return null
}

/** One `key: value` pair, or a shorthand `key`. */
function readEntry(
  text: string,
  from: number,
): { entry: ObjectEntry | null; end: number } | null {
  const key = readKey(text, from)
  if (!key) return null

  const afterKey = skipSpace(text, key.end)
  if (text[afterKey] !== ":") {
    // Shorthand: `{ colors }` means the declaration named `colors`.
    if (key.computed) return { entry: null, end: afterKey }
    return {
      entry: { kind: "property", key: key.name, value: { kind: "ref", name: key.name } },
      end: afterKey,
    }
  }

  const value = readValue(text, afterKey + 1)
  // An unreadable value takes its entry with it; the object carries on from
  // the end of the expression.
  if (!value) {
    const end = skipExpression(text, afterKey + 1)
    return end === null ? null : { entry: null, end }
  }

  if (key.computed) return { entry: null, end: value.end }
  return { entry: { kind: "property", key: key.name, value: value.node }, end: value.end }
}

interface Key {
  name: string
  computed: boolean
  end: number
}

function readKey(text: string, from: number): Key | null {
  const at = skipSpace(text, from)
  const char = text[at]
  if (char === undefined) return null

  if (char === '"' || char === "'" || char === "`") {
    const read = readString(text, at)
    if (!read || read.node.kind !== "literal") return null
    return { name: String(read.node.value), computed: false, end: read.end }
  }

  if (char === "[") {
    // A computed key depends on a value Drift cannot see. Skip past it.
    const end = matchBracket(text, at, "[", "]")
    return end === null ? null : { name: "", computed: true, end }
  }

  const word = /^[A-Za-z_$][\w$]*|^\d+(?:\.\d+)?/.exec(text.slice(at))
  if (!word) return null
  return { name: word[0], computed: false, end: at + word[0].length }
}

function readArray(text: string, from: number): Read | null {
  const items: Node[] = []
  let at = skipSpace(text, from + 1)

  while (at < text.length) {
    if (text[at] === "]") return { node: { kind: "array", items }, end: at + 1 }

    const value = readValue(text, at)
    if (value) {
      items.push(value.node)
      at = value.end
    } else {
      const end = skipExpression(text, at)
      if (end === null) return null
      at = end
    }

    at = skipSpace(text, at)
    if (text[at] === ",") at = skipSpace(text, at + 1)
  }

  return null
}

function readString(text: string, from: number): Read | null {
  const quote = text[from]!
  let value = ""
  let at = from + 1

  while (at < text.length) {
    const char = text[at]!
    if (char === "\\") {
      const next = text[at + 1]
      if (next === undefined) return null
      value += unescape(next)
      at += 2
      continue
    }
    if (char === quote) return { node: { kind: "literal", value }, end: at + 1 }
    // A template with a hole is a value that depends on something else.
    if (quote === "`" && char === "$" && text[at + 1] === "{") return null
    value += char
    at += 1
  }

  return null
}

function unescape(char: string): string {
  switch (char) {
    case "n":
      return "\n"
    case "t":
      return "\t"
    case "r":
      return "\r"
    default:
      return char
  }
}

function readNumber(text: string, from: number): Read | null {
  const match = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(text.slice(from))
  if (!match) return null
  const value = Number(match[0])
  if (!Number.isFinite(value)) return null
  return { node: { kind: "literal", value }, end: from + match[0].length }
}

/**
 * Walks past an expression Drift will not read, stopping at the comma or the
 * closing bracket that ends it, so one unreadable entry does not cost the
 * whole object.
 */
function skipExpression(text: string, from: number): number | null {
  let at = skipSpace(text, from)

  while (at < text.length) {
    const char = text[at]!
    if (char === "," || char === "}" || char === "]") return at
    if (char === '"' || char === "'" || char === "`") {
      const end = skipString(text, at)
      if (end === null) return null
      at = end
      continue
    }
    if (char === "(") {
      const end = matchBracket(text, at, "(", ")")
      if (end === null) return null
      at = end
      continue
    }
    if (char === "{") {
      const end = matchBracket(text, at, "{", "}")
      if (end === null) return null
      at = end
      continue
    }
    if (char === "[") {
      const end = matchBracket(text, at, "[", "]")
      if (end === null) return null
      at = end
      continue
    }
    at += 1
  }

  return null
}

/** Index just past the bracket that closes the one at `from`. */
function matchBracket(text: string, from: number, open: string, close: string): number | null {
  let depth = 0
  let at = from

  while (at < text.length) {
    const char = text[at]!
    if (char === '"' || char === "'" || char === "`") {
      const end = skipString(text, at)
      if (end === null) return null
      at = end
      continue
    }
    if (char === open) depth += 1
    if (char === close) {
      depth -= 1
      if (depth === 0) return at + 1
    }
    at += 1
  }

  return null
}

function skipString(text: string, from: number): number | null {
  const quote = text[from]!
  let at = from + 1

  while (at < text.length) {
    const char = text[at]!
    if (char === "\\") {
      at += 2
      continue
    }
    if (char === quote) return at + 1
    at += 1
  }

  return null
}

function skipSpace(text: string, from: number): number {
  let at = from
  while (at < text.length && /\s/.test(text[at]!)) at += 1
  return at
}

/**
 * Blanks out comments, keeping the source the same length so every index still
 * lines up. Quotes are tracked, so a `//` inside a string stays a string.
 */
export function stripComments(source: string): string {
  const out: string[] = []
  let at = 0

  while (at < source.length) {
    const char = source[at]!

    if (char === '"' || char === "'" || char === "`") {
      const end = skipString(source, at) ?? source.length
      out.push(source.slice(at, end))
      at = end
      continue
    }

    if (char === "/" && source[at + 1] === "/") {
      const end = source.indexOf("\n", at)
      const stop = end === -1 ? source.length : end
      out.push(" ".repeat(stop - at))
      at = stop
      continue
    }

    if (char === "/" && source[at + 1] === "*") {
      const end = source.indexOf("*/", at + 2)
      const stop = end === -1 ? source.length : end + 2
      out.push(source.slice(at, stop).replace(/[^\n]/g, " "))
      at = stop
      continue
    }

    out.push(char)
    at += 1
  }

  return out.join("")
}

function isRecord(value: LiteralValue): value is Record<string, LiteralValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
