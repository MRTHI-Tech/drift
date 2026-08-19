/**
 * The mechanical patch class, and its outer edge.
 *
 * Drift changes two things in a watched repo and nothing else: the text of a
 * label, and a value that missed its token. Both are substitutions of one
 * literal for another, planned by matching the literal character for character
 * in the repo's own source. Nothing here parses the code, reasons about what a
 * component does, moves anything, or writes a line that was not already there.
 *
 * That boundary is permanent. Anything needing a judgment about code structure,
 * where a value should come from, which component owns a label, whether a
 * change is safe to make twice, is out of scope for the agent for good. When a
 * patch cannot be planned mechanically the finding is reported and waits for a
 * person, which is the correct outcome rather than a failure.
 */

import type { SourceFile } from "../github"
import type { Finding } from "../types"
import type { TokenGroup } from "../analysis/tokens"
import { MAX_PATCH_OCCURRENCES } from "./constants"
import { sourceSpellings, valueGroupOf } from "./spellings"

/** Where a literal is read from, and therefore how it is bounded in source. */
export type PatchKind = "copy" | "value"

/**
 * Which way round the substitution runs. `conform` changes this screen to match
 * its siblings; `siblings` changes everything else to match this screen. Both
 * are the same operation with the values swapped.
 */
export type PatchDirection = "conform" | "siblings"

/** One file, before and after. */
export interface FileEdit {
  path: string
  before: string
  after: string
  occurrences: number
}

/**
 * Who planned a patch, and therefore how much it is trusted.
 *
 * `mechanical` is a substitution matched character for character in the repo's
 * own source, which cannot be wrong about code it never read. `model` is a
 * plan the Fixer wrote after reading the code, which has been through the fix
 * gate and is still a proposal: it is opened as a draft and is never
 * unprompted. Everything downstream can tell the two apart without asking how
 * either was made.
 */
export type PatchAuthor = "mechanical" | "model"

/** What a patch would do, computed without writing anything anywhere. */
export interface PatchPlan {
  kind: PatchKind
  author: PatchAuthor
  /** The literal being replaced, as the finding records it. */
  from: string
  /** The literal replacing it. */
  to: string
  files: FileEdit[]
  occurrences: number
  /**
   * Why nothing could be planned, in one line a person can act on. Null when
   * the plan has edits.
   */
  blocked: string | null
}

export interface PlanPatchInput {
  kind: PatchKind
  from: string
  to: string
  /** The scale the value answers to, for its spellings. Null for copy. */
  group: TokenGroup | null
  files: readonly SourceFile[]
  maxOccurrences?: number
}

/** Whether a finding's value is a label or a resolved style value. */
export function patchKindOf(finding: Finding): PatchKind {
  if (finding.type === "token") return "value"
  return finding.evidence.property.endsWith(".label") ? "copy" : "value"
}

/**
 * The patch one finding implies, in one direction. Pure: the same finding over
 * the same files always plans the same edits.
 */
export function planFindingPatch(
  finding: Finding,
  direction: PatchDirection,
  files: readonly SourceFile[],
): PatchPlan {
  const kind = patchKindOf(finding)
  const { observedValue, expectedValue, property } = finding.evidence

  const from = direction === "conform" ? observedValue : expectedValue
  const to = direction === "conform" ? expectedValue : observedValue

  return planPatch({
    kind,
    from,
    to,
    group: kind === "copy" ? null : valueGroupOf(property),
    files,
  })
}

/**
 * Every edit a substitution would make. Blocked rather than partial when the
 * literal is not there, when it is everywhere, or when the two values are the
 * same thing written two ways.
 */
export function planPatch(input: PlanPatchInput): PatchPlan {
  const max = input.maxOccurrences ?? MAX_PATCH_OCCURRENCES
  const empty = (blocked: string): PatchPlan => ({
    kind: input.kind,
    author: "mechanical",
    from: input.from,
    to: input.to,
    files: [],
    occurrences: 0,
    blocked,
  })

  const from = input.from.trim()
  const to = input.to.trim()
  if (from.length === 0) return empty("The finding records no value to replace.")
  if (to.length === 0) return empty("The finding records nothing to replace it with.")

  const fromSpellings = input.kind === "copy" ? [from] : sourceSpellings(from, input.group)
  const toSpellings = input.kind === "copy" ? [to] : sourceSpellings(to, input.group)
  if (fromSpellings.some((spelling) => toSpellings.includes(spelling))) {
    return empty(`${from} and ${to} are the same value written two ways.`)
  }

  const patterns = fromSpellings.flatMap((spelling) => patternsFor(spelling, input.kind))

  const files: FileEdit[] = []
  let occurrences = 0
  for (const file of input.files) {
    const replaced = replaceAll(file.text, patterns, to)
    if (replaced.count === 0) continue
    files.push({
      path: file.path,
      before: file.text,
      after: replaced.text,
      occurrences: replaced.count,
    })
    occurrences += replaced.count
  }

  if (occurrences === 0) {
    return empty(
      input.kind === "copy"
        ? `No source file writes ${from} as a label. It is probably built from data rather than typed in.`
        : `No source file writes ${from}. It is probably composed at runtime rather than written down.`,
    )
  }
  if (occurrences > max) {
    return empty(
      `${from} appears ${occurrences} times, over the limit of ${max}. ` +
        "Replacing all of them is not a mechanical change.",
    )
  }

  return { kind: input.kind, author: "mechanical", from, to, files, occurrences, blocked: null }
}

/** The files a plan touches, as the paths a pull request body lists. */
export function patchedPaths(plan: PatchPlan): string[] {
  return plan.files.map((file) => file.path)
}

/** A bounded way of writing one literal, and how to write the new one back. */
interface Pattern {
  regex: RegExp
  /** Rebuilds the match with `to` in place of the literal, keeping its surroundings. */
  rewrite: (groups: readonly string[], to: string) => string
}

/**
 * How a literal is bounded in source, which is the whole difference between a
 * mechanical patch and a find and replace.
 *
 * A label counts only where it is the entire contents of a string literal or
 * the entire text of an element. `Next` inside `Next.js`, inside a comment, or
 * inside a longer sentence is not a label, and is left alone.
 *
 * A value counts only where it is not part of a longer one. `#ff0000` does not
 * match inside `#ff0000ff`, and `18px` does not match inside `118px` or
 * `-18px`.
 */
function patternsFor(spelling: string, kind: PatchKind): Pattern[] {
  const escaped = escapeRegExp(spelling)

  if (kind === "copy") {
    return [
      {
        // A complete string literal, in any of the three quotes.
        regex: new RegExp(`(["'\`])${escaped}\\1`, "g"),
        rewrite: (groups, to) => `${groups[0] ?? '"'}${to}${groups[0] ?? '"'}`,
      },
      {
        // The entire text of an element: <button>Next</button>.
        regex: new RegExp(`>(\\s*)${escaped}(\\s*)<`, "g"),
        rewrite: (groups, to) => `>${groups[0] ?? ""}${to}${groups[1] ?? ""}<`,
      },
    ]
  }

  const bounded = spelling.startsWith("#")
    ? // A hex value, which must not be the front of a longer one.
      new RegExp(`(?<![\\w#])${escaped}(?![0-9a-fA-F])`, "g")
    : spelling.includes("(")
      ? // A function call, bounded by its own parentheses.
        new RegExp(`(?<![\\w-])${escaped}`, "g")
      : // A length, which must not be part of a longer or a negative number.
        new RegExp(`(?<![\\w.#-])${escaped}(?![\\w])`, "g")

  return [{ regex: bounded, rewrite: (_groups, to) => to }]
}

/**
 * Replaces the bounded part of every match, leaving the quotes, whitespace, and
 * punctuation around it exactly as they were.
 */
function replaceAll(
  text: string,
  patterns: readonly Pattern[],
  to: string,
): { text: string; count: number } {
  let current = text
  let count = 0

  for (const pattern of patterns) {
    current = current.replace(pattern.regex, (_match, ...rest) => {
      const groups = rest
        .slice(0, -2)
        .map((group) => (typeof group === "string" ? group : ""))
      count += 1
      return pattern.rewrite(groups, to)
    })
  }

  return { text: current, count }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
