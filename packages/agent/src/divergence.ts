/**
 * Where one screen departs from its archetype's conventions. Computed before
 * any model is called and computed by comparison alone: the screen's profile
 * against the stored conventions, value against value.
 *
 * This is the list the model is allowed to comment on, and it is the whole of
 * it. The model never sees the screen and the question "what is wrong here";
 * it sees candidates that are already true and answers only whether each one
 * matters and how to say it. A screen with no candidates is never sent
 * anywhere.
 */

import type { Convention } from "@drift/core"

import { profileValue, severityOf, type ProfileKind, type ScreenProfile } from "./profile"

/** One place a screen and a convention disagree. Every field is already true. */
export interface DivergenceCandidate {
  conventionId: string
  property: string
  kind: ProfileKind
  /** The element the observed value was read from. */
  selector: string
  /** Exactly as the extraction recorded it. */
  observedValue: string
  /** What the archetype's other screens render. */
  expectedValue: string
  /** The convention's name, for the finding's `expectedSource`. */
  expectedSource: string
  /** The screens that render the expected value. */
  siblingScreenIds: string[]
  severity: number
}

export interface DivergenceInput {
  screenId: string
  profile: ScreenProfile
  conventions: readonly Convention[]
}

/**
 * Every candidate for one screen, in the order its conventions came in.
 *
 * Four things are never a candidate: a convention the user removed, a
 * convention that already counts this screen as evidence, a property the
 * screen holds no value for, and a convention carrying an exception for this
 * screen. The last is permanent by design (AGENTS.md section 6): once a person
 * has said a screen is allowed to differ, Drift does not ask again.
 */
export function divergenceCandidates(input: DivergenceInput): DivergenceCandidate[] {
  const candidates: DivergenceCandidate[] = []

  for (const convention of input.conventions) {
    if (convention.status === "removed") continue
    if (convention.evidenceScreenIds.includes(input.screenId)) continue
    if (convention.exceptions.some((exception) => exception.screenId === input.screenId)) continue

    const observed = profileValue(input.profile, convention.property)
    if (!observed) continue
    if (observed.value === convention.value) continue

    candidates.push({
      conventionId: convention.id,
      property: convention.property,
      kind: observed.kind,
      selector: observed.selector,
      observedValue: observed.value,
      expectedValue: convention.value,
      expectedSource: convention.label,
      siblingScreenIds: convention.evidenceScreenIds,
      severity: severityOf(convention.property),
    })
  }

  return candidates
}
