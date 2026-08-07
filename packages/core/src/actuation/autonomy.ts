/**
 * The boundary between what Drift may do unprompted and what waits for a
 * person.
 *
 * It is one function on purpose. Anywhere in the system that opens a pull
 * request without being asked has to come through `isAutonomousFix`, so the
 * whole of Drift's autonomy is auditable by reading one file, and widening it
 * is a visible change to one place rather than a condition that grew somewhere.
 *
 * The function returns a reason either way, and callers log it. A finding that
 * did not qualify is not a failure; it is a finding waiting for a human
 * resolution, which is the default state of everything Drift notices.
 */

import { valueGroupOf } from "./spellings"
import { MAX_AUTONOMOUS_DISTANCE, PATCHABLE_GROUPS } from "./constants"
import type { PatchPlan } from "./patch"
import type { Finding } from "../types"

export interface AutonomyInput {
  finding: Finding
  /** The patch that would be opened. Planned before this is asked. */
  plan: PatchPlan
  /**
   * How far the observed value sits from the token it would be snapped to:
   * OKLab distance for a colour, pixels for a length. Null when the run that
   * raised the finding is not the one asking, and therefore does not know.
   */
  nearestTokenDistance: number | null
}

export interface AutonomyDecision {
  autonomous: boolean
  /** The rule that decided it, in one line. Always set, either way. */
  reason: string
}

/**
 * Whether Drift may open this pull request without being asked.
 *
 * Every condition below has to hold. In order:
 *
 *  1. It is a token finding. Pattern drift is a question about what a product
 *     means to say, and the answer belongs to a person: a screen that says Next
 *     where its siblings say Continue might be the one screen that is right.
 *     A token finding has no such question. The repo declares a scale and a
 *     value missed it.
 *  2. Nobody has decided anything about it yet. A finding that is resolved,
 *     dismissed, or already carries a pull request is not Drift's to act on.
 *  3. It names the token it missed. Without one there is nothing to substitute.
 *  4. The patch is a value substitution, not a copy change, and its scale is
 *     one that can be written down unambiguously in source.
 *  5. The patch is exactly one occurrence in exactly one file. Two occurrences
 *     is two decisions, and Drift does not make two at once unprompted.
 *  6. The value is close enough to its token that snapping it is a correction
 *     rather than a choice. A far-off value is a colour somebody meant.
 */
export function isAutonomousFix(input: AutonomyInput): AutonomyDecision {
  const { finding, plan } = input

  if (finding.type !== "token") {
    return no("Pattern drift is a judgment about the product, so it waits for a person.")
  }

  if (finding.status !== "open") {
    return no(`The finding is already ${finding.status}.`)
  }

  if (finding.prNumber !== null) {
    return no(`The finding already carries pull request ${finding.prNumber}.`)
  }

  const { expectedValue, expectedSource, property } = finding.evidence
  if (!expectedSource || expectedValue.length === 0) {
    return no("The value is on no scale Drift could name, so there is nothing to substitute.")
  }

  if (plan.kind !== "value") {
    return no("Only a value substitution is opened unprompted.")
  }

  const group = valueGroupOf(property)
  if (!group || !PATCHABLE_GROUPS.includes(group)) {
    return no(`${property} is not written in source as a literal Drift can bound.`)
  }

  if (plan.blocked !== null) {
    return no(plan.blocked)
  }

  if (plan.occurrences !== 1 || plan.files.length !== 1) {
    return no(
      `${plan.from} appears ${plan.occurrences} times in ${plan.files.length} files. ` +
        "Only a single occurrence is changed unprompted.",
    )
  }

  const distance = input.nearestTokenDistance
  if (distance === null) {
    return no("How far the value sits from its token is not known here.")
  }

  const limit = MAX_AUTONOMOUS_DISTANCE[group]
  if (distance > limit) {
    return no(
      `${plan.from} sits ${round(distance)} from ${expectedSource}, past the limit of ${limit}. ` +
        "That far off is a choice somebody made.",
    )
  }

  return {
    autonomous: true,
    reason:
      `${plan.from} is one occurrence in ${plan.files[0]?.path ?? "one file"}, ` +
      `${round(distance)} from ${expectedSource}.`,
  }
}

function no(reason: string): AutonomyDecision {
  return { autonomous: false, reason }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
