/**
 * The fix gate: what a model-authored patch has to survive before it can
 * become a pull request.
 *
 * AGENTS.md section 10a used to hold the whole of this risk by refusing the
 * class outright. A patch was mechanical or it did not exist, and the reason
 * that was safe is that a substitution planned character for character cannot
 * be wrong about the code it edits, because it never read it. Section 10a now
 * admits a second class, and this file is what was put in its place. It is to
 * a patch what the reconciliation gate is to a finding: the model proposes,
 * and nothing it proposes is taken on its word.
 *
 * Six rules, and an edit that fails any one is dropped and counted.
 *
 *   1. The file is one the Fixer was given. It cannot edit what it never read,
 *      and it cannot name a path that was not in the set.
 *   2. The path is source by `isSourcePath`, re-checked here because the path
 *      arrived from a model rather than from the tree walk.
 *   3. The text it wants to replace appears in that file exactly once, as it
 *      currently stands. Not zero times, which means the model is editing a
 *      file it has misremembered, and not twice, which means it does not know
 *      which of them it meant.
 *   4. The replacement is not the text it replaces, and neither is empty. An
 *      edit that deletes its whole match is a deletion, and deletion is not a
 *      fix for a value being wrong.
 *   5. The edits together stay inside the bounds: so many files, so many
 *      lines. A correct fix for one finding is small. A large one is a
 *      refactor the model decided to do on the way past.
 *   6. Somewhere in what it wrote, the value the finding asked for actually
 *      appears, in one of the spellings source is allowed to write it in. An
 *      edit set that never mentions the target value is not a fix for this
 *      finding whatever else it is.
 *
 * What the gate cannot do is tell whether the result compiles or whether the
 * change is the right one to have made. Nothing short of building the watched
 * repo could, and Drift does not build it. That is why a plan from here is
 * marked `model` and why what it opens is a draft.
 */

import { isSourcePath } from "../github"
import type { SourceFile } from "../github"
import type { TokenGroup } from "../analysis/tokens"
import { MAX_FIX_FILES, MAX_FIX_LINES } from "./constants"
import type { FileEdit, PatchPlan } from "./patch"
import { sourceSpellings } from "./spellings"

/** One edit exactly as the model proposed it. Nothing here is trusted yet. */
export interface ProposedEdit {
  path: string
  /** The text to find, which has to be there once and only once. */
  find: string
  /** What goes in its place. */
  replace: string
}

/** Why one edit did not survive. Counted, and logged by the caller. */
export type FixDropReason =
  | "unknown-file"
  | "not-source"
  | "absent"
  | "ambiguous"
  | "empty"
  | "no-change"
  | "too-large"

export interface FixGateInput {
  edits: readonly ProposedEdit[]
  /** Exactly the files the Fixer was given, as they stand on the branch. */
  files: readonly SourceFile[]
  /** The value the fix is supposed to arrive at. */
  to: string
  /** The scale that value answers to, for its spellings. Null for copy. */
  group: TokenGroup | null
  kind: PatchPlan["kind"]
  /** The value the fix is supposed to move away from, for the plan it returns. */
  from: string
}

export interface FixGateResult {
  /**
   * The plan, or null when nothing survived. Marked `model` so that everything
   * downstream can tell where it came from without asking how it was made.
   */
  plan: PatchPlan | null
  proposed: number
  kept: number
  dropped: Record<FixDropReason, number>
  /** One line per drop, in the order they happened, for the run log. */
  reasons: string[]
}

function noDrops(): Record<FixDropReason, number> {
  return {
    "unknown-file": 0,
    "not-source": 0,
    absent: 0,
    ambiguous: 0,
    empty: 0,
    "no-change": 0,
    "too-large": 0,
  }
}

/** How many lines an edit disturbs. The larger of what it removes and adds. */
function editLines(edit: ProposedEdit): number {
  return Math.max(edit.find.split("\n").length, edit.replace.split("\n").length)
}

/** Occurrences of a literal, counted without treating any of it as a pattern. */
function countOf(haystack: string, needle: string): number {
  let count = 0
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    count += 1
    at = haystack.indexOf(needle, at + needle.length)
  }
  return count
}

/**
 * Runs every proposed edit through the gate and returns the plan that
 * survived. Never throws: a malformed proposal is a drop, not an error, the
 * same way a malformed assessment is a drop in `reconcile`.
 */
export function gateProposedFix(input: FixGateInput): FixGateResult {
  const dropped = noDrops()
  const reasons: string[] = []
  const drop = (reason: FixDropReason, line: string): void => {
    dropped[reason] += 1
    reasons.push(line)
  }

  const originals = new Map(input.files.map((file) => [file.path, file.text]))
  const current = new Map(originals)
  const touched = new Set<string>()
  let lines = 0
  let kept = 0

  for (const edit of input.edits) {
    const text = current.get(edit.path)
    if (text === undefined) {
      drop("unknown-file", `${edit.path} is not a file the Fixer was given.`)
      continue
    }
    if (!isSourcePath(edit.path)) {
      drop("not-source", `${edit.path} is not a source file.`)
      continue
    }
    if (edit.find.length === 0 || edit.replace.length === 0) {
      drop("empty", `An edit to ${edit.path} has nothing to find or nothing to write.`)
      continue
    }
    if (edit.find === edit.replace) {
      drop("no-change", `An edit to ${edit.path} replaces its match with itself.`)
      continue
    }

    const occurrences = countOf(text, edit.find)
    if (occurrences === 0) {
      drop("absent", `${edit.path} does not contain the text the Fixer wanted to replace.`)
      continue
    }
    if (occurrences > 1) {
      drop(
        "ambiguous",
        `The text the Fixer wanted to replace appears ${occurrences} times in ${edit.path}.`,
      )
      continue
    }

    const wouldTouch = new Set(touched).add(edit.path)
    const wouldSpan = lines + editLines(edit)
    if (wouldTouch.size > MAX_FIX_FILES || wouldSpan > MAX_FIX_LINES) {
      drop(
        "too-large",
        `An edit to ${edit.path} would take the fix past ${MAX_FIX_FILES} files ` +
          `or ${MAX_FIX_LINES} lines.`,
      )
      continue
    }

    current.set(edit.path, text.replace(edit.find, edit.replace))
    touched.add(edit.path)
    lines = wouldSpan
    kept += 1
  }

  const result: FixGateResult = {
    plan: null,
    proposed: input.edits.length,
    kept,
    dropped,
    reasons,
  }
  if (kept === 0) return result

  // Rule 6. Everything above only checked that the edits are applicable; this
  // asks whether they are a fix for the finding that asked for them.
  const spellings = input.kind === "copy" ? [input.to.trim()] : sourceSpellings(input.to, input.group)
  const arrived = [...touched].some((path) => {
    const before = originals.get(path) ?? ""
    const after = current.get(path) ?? ""
    return spellings.some((spelling) => countOf(after, spelling) > countOf(before, spelling))
  })
  if (!arrived) {
    reasons.push(`Nothing the Fixer wrote contains ${input.to}, so it is not a fix for this finding.`)
    return { ...result, kept: 0 }
  }

  const files: FileEdit[] = [...touched]
    .sort()
    .map((path) => ({
      path,
      before: originals.get(path) ?? "",
      after: current.get(path) ?? "",
      occurrences: 1,
    }))

  return {
    ...result,
    plan: {
      kind: input.kind,
      author: "model",
      from: input.from.trim(),
      to: input.to.trim(),
      files,
      occurrences: kept,
      blocked: null,
    },
  }
}
