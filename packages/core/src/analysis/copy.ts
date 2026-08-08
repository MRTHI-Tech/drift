/**
 * Copy heuristics: what case a line is written in, and whether it gives an
 * instruction. Word lists and rules only, no model call (AGENTS.md section 4).
 *
 * These are flags on a signature, not judgments. The question of whether a
 * screen's copy actually breaks the product's convention belongs to the
 * judgment phase, which reads these flags and the sibling screens together.
 */

import type { CopyCase, CopyTally } from "../types"

/** Every case, in the order a tally reports them. */
export const COPY_CASES = [
  "sentence",
  "title",
  "upper",
  "lower",
  "other",
] as const satisfies readonly CopyCase[]

/**
 * Words a title-case line is allowed to leave lowercase. Without this,
 * "Back to top" reads as sentence case and "Save and Continue" reads as other.
 */
const MINOR_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "from",
  "in",
  "nor",
  "of",
  "on",
  "or",
  "per",
  "the",
  "to",
  "up",
  "via",
  "with",
])

/**
 * Verbs a call to action starts with when it is written in the imperative.
 * A closed list on purpose: "does this word happen to be a verb here" is a
 * judgment, and a judgment needs the model phase, not a guess in this one.
 */
const IMPERATIVE_VERBS = new Set([
  "add",
  "apply",
  "book",
  "browse",
  "build",
  "buy",
  "cancel",
  "change",
  "check",
  "choose",
  "clear",
  "close",
  "compare",
  "confirm",
  "connect",
  "contact",
  "continue",
  "copy",
  "create",
  "delete",
  "deploy",
  "discover",
  "dismiss",
  "download",
  "edit",
  "enable",
  "enter",
  "explore",
  "export",
  "find",
  "finish",
  "get",
  "go",
  "import",
  "install",
  "invite",
  "join",
  "learn",
  "leave",
  "log",
  "manage",
  "move",
  "open",
  "pick",
  "publish",
  "read",
  "remove",
  "rename",
  "reset",
  "resolve",
  "retry",
  "return",
  "save",
  "search",
  "see",
  "select",
  "send",
  "share",
  "sign",
  "skip",
  "start",
  "submit",
  "subscribe",
  "switch",
  "try",
  "update",
  "upgrade",
  "upload",
  "view",
  "watch",
])

/** A run of letters, digits, and the apostrophes inside a word. */
const WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu

/**
 * How a line is capitalised. A single capitalised word is sentence case, which
 * is what Drift's own copy rules call it (AGENTS.md section 6); title case
 * needs a second capitalised word to be visible at all.
 */
export function detectCase(text: string): CopyCase {
  const words = text.match(WORD_PATTERN) ?? []
  const letterWords = words.filter((word) => /\p{L}/u.test(word))
  if (letterWords.length === 0) return "other"

  const letters = letterWords.join("")
  if (letters.length > 1 && letters === letters.toUpperCase()) return "upper"
  if (letters === letters.toLowerCase()) return "lower"

  const capitalised = (word: string): boolean => {
    const first = [...word][0] ?? ""
    return first === first.toUpperCase() && first !== first.toLowerCase()
  }

  const [first, ...rest] = letterWords
  if (!capitalised(first!)) return "other"

  const significant = rest.filter((word) => !MINOR_WORDS.has(word.toLowerCase()))
  if (significant.length > 0 && significant.every(capitalised)) return "title"
  if (rest.every((word) => !capitalised(word))) return "sentence"

  // A proper noun mid-line, or something in between. Deliberately not guessed.
  return "other"
}

/**
 * Whether a line reads as an instruction: it opens with a known verb and is
 * not a question. "Get started" is imperative, "Getting started" is not, and
 * "Your plan" is not.
 */
export function isImperative(text: string): boolean {
  if (text.includes("?")) return false
  const first = (text.match(WORD_PATTERN) ?? [])[0]
  return first !== undefined && IMPERATIVE_VERBS.has(first.toLowerCase())
}

/**
 * Labels that would fit on any screen in any product. A closed list on
 * purpose, and a short one: "is this word specific enough" is a judgment, and
 * a judgment belongs to the model phase, not to a guess in this one. Anything
 * not on this list is treated as naming its own action.
 *
 * Matched on the whole label, lowercased, with punctuation dropped, so "Next"
 * is generic and "Next step in your rhythm" is not.
 */
const GENERIC_LABELS = new Set([
  "back",
  "cancel",
  "close",
  "confirm",
  "continue",
  "done",
  "finish",
  "get started",
  "go",
  "got it",
  "learn more",
  "next",
  "no",
  "ok",
  "okay",
  "save",
  "skip",
  "start",
  "submit",
  "yes",
])

/**
 * Whether a label names the action it performs or could sit on any screen.
 *
 * This is what lets a convention be stated over a quality rather than over a
 * string. A product whose buttons say "Build our rhythm" and "Add to my prayer
 * list" has a convention, but no two of those labels are ever the same words,
 * so counting the words finds nothing. Counting the kind finds it.
 *
 * Deterministic and list-based, so the same label always classifies the same
 * way and the reconciliation gate can re-derive it from the record.
 */
export function labelVoice(label: string): "generic" | "specific" {
  const words = (label.match(WORD_PATTERN) ?? []).map((word) => word.toLowerCase())
  if (words.length === 0) return "generic"

  return GENERIC_LABELS.has(words.join(" ")) ? "generic" : "specific"
}

export function emptyTally(): CopyTally {
  return {
    count: 0,
    sentence: 0,
    title: 0,
    upper: 0,
    lower: 0,
    other: 0,
    imperative: 0,
    dominantCase: null,
  }
}

/** Tallies a set of lines. Order in does not change the result. */
export function tallyCopy(lines: readonly string[]): CopyTally {
  const tally = emptyTally()

  for (const line of lines) {
    const text = line.trim()
    if (text.length === 0) continue
    tally.count += 1
    tally[detectCase(text)] += 1
    if (isImperative(text)) tally.imperative += 1
  }

  tally.dominantCase = dominant(tally)
  return tally
}

/**
 * A majority, not a plurality. Three sentence-case labels out of eight is how
 * the copy happens to fall, not how the product writes.
 */
function dominant(tally: CopyTally): CopyCase | null {
  if (tally.count === 0) return null
  for (const copyCase of COPY_CASES) {
    if (tally[copyCase] * 2 > tally.count) return copyCase
  }
  return null
}
