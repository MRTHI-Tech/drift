/**
 * The reconciliation gate (AGENTS.md section 3), non-negotiable.
 *
 * Nothing a model says about a screen reaches Firestore until the value it
 * cites has been read back out of that screen's extraction record. The model
 * comments on candidates; it never originates facts. There is no flag that
 * turns this off and no caller that can go around it: the judge flow returns
 * findings that have already been through here, and it returns nothing else.
 *
 * A proposal has three ways to fail.
 *
 *   1. It names a candidate that was never on the list. The model was given a
 *      numbered set of divergences and may only answer within it.
 *   2. The value it cites is not in the record for the element it cites. This
 *      is the gate proper. The finding is dropped silently and counted.
 *   3. The value it cites is real but is not the candidate's value, so the
 *      model has commented on something other than what it was asked about.
 *
 * A style value is verified against `computedStyles`, which is where a resolved
 * style value lives. A copy value is verified against `text`, which is the same
 * extraction keyed by the same selectors and is where an element's visible
 * words live. A derived value is verified by working it out from `text` again
 * and comparing, because it is a reading of the record rather than an entry in
 * it. In all three the cited element must appear in `computedStyles` or there
 * is no record of it at all. Both records are written by the deterministic
 * extraction phase and neither is reachable by a model.
 *
 * Because a candidate's value is copied out of the record rather than
 * described, an honest model always passes. The gate only ever fires on a
 * model that has invented, rounded, reworded, or misattributed a value, which
 * is exactly the failure it exists to catch.
 */

import { valueAppearsIn, type ComputedStyles, type ScreenText } from "@drift/core"

import { MAX_SENTENCE_LENGTH } from "./constants"
import type { DivergenceCandidate } from "./divergence"
import { deriveValue, profileProperty, resolveLabel, type ProfileKind } from "./profile"

/** The part of a screen's extraction the gate reads. */
export interface ExtractionSlice {
  computedStyles: ComputedStyles
  text: ScreenText
}

/** What the model returned about one candidate. */
export interface Assessment {
  /** Index into the candidate list the model was given. */
  candidateIndex: number
  /** Whether the divergence is worth raising at all. */
  material: boolean
  /** The element the model claims the value sits on. */
  citedSelector: string
  citedProperty: string
  /** The value the model claims is there. Checked against the record. */
  citedValue: string
  /** The one line a person reads. */
  sentence: string
}

/** A candidate that survived, with the line that will be stored beside it. */
export interface JudgedDivergence {
  candidate: DivergenceCandidate
  sentence: string
}

export interface GateResult {
  kept: JudgedDivergence[]
  /** Assessments the model returned. */
  proposed: number
  /** Divergences the model judged immaterial. Not a failure. */
  immaterial: number
  /**
   * Findings dropped because a cited value is not in the screen's record.
   * This is the counter AGENTS.md section 3 requires to be logged.
   */
  dropped: number
  /** Proposals naming a candidate, an element, or a value outside the list. */
  droppedOutsideCandidates: number
  /** Sentences replaced because the model's own line was unusable. */
  sentencesRewritten: number
}

export interface ReconcileInput {
  candidates: readonly DivergenceCandidate[]
  assessments: readonly Assessment[]
  extraction: ExtractionSlice
}

/**
 * Runs every proposal through the gate. Returns only what survived, plus the
 * counters the caller logs. Never throws: a malformed proposal is a drop, not
 * an error.
 */
export function reconcile(input: ReconcileInput): GateResult {
  const kept: JudgedDivergence[] = []
  const seen = new Set<number>()
  let immaterial = 0
  let dropped = 0
  let droppedOutsideCandidates = 0
  let sentencesRewritten = 0

  for (const assessment of input.assessments) {
    const candidate = input.candidates[assessment.candidateIndex]
    if (!candidate || seen.has(assessment.candidateIndex)) {
      droppedOutsideCandidates += 1
      continue
    }
    seen.add(assessment.candidateIndex)

    if (!assessment.material) {
      immaterial += 1
      continue
    }

    // The gate. Everything before this is bookkeeping; this is the rule.
    if (
      !valueIsRecorded(
        input.extraction,
        candidate.kind,
        assessment.citedSelector,
        assessment.citedProperty,
        assessment.citedValue,
      )
    ) {
      dropped += 1
      continue
    }

    if (!citesTheCandidate(candidate, assessment)) {
      droppedOutsideCandidates += 1
      continue
    }

    const sentence = usableSentence(assessment.sentence, candidate)
    if (sentence.rewritten) sentencesRewritten += 1
    kept.push({ candidate, sentence: sentence.value })
  }

  return {
    kept,
    proposed: input.assessments.length,
    immaterial,
    dropped,
    droppedOutsideCandidates,
    sentencesRewritten,
  }
}

/**
 * Whether the screen really records this value on this element. The only
 * question the gate asks, and the only source it will accept an answer from.
 */
export function valueIsRecorded(
  extraction: ExtractionSlice,
  kind: ProfileKind,
  selector: string,
  property: string,
  value: string,
): boolean {
  // No computed-style record for the cited element means no record at all.
  if (!extraction.computedStyles[selector]) return false

  if (kind === "style") {
    const definition = profileProperty(property)
    if (!definition || definition.kind !== "style" || !definition.styleProperty) return false
    return valueAppearsIn(extraction.computedStyles, selector, definition.styleProperty, value)
  }

  // A derived value is verified by deriving it again from the same record. The
  // model cannot reach the function or the record, so a cited value that does
  // not match is a value the model made up, exactly as with the other two.
  if (kind === "derived") {
    return deriveValue(property, extraction.text, selector) === value.trim()
  }

  return resolveLabel(extraction.text, selector) === value.trim()
}

/** Whether the proposal is about the candidate it claims to be about. */
function citesTheCandidate(candidate: DivergenceCandidate, assessment: Assessment): boolean {
  return (
    assessment.citedSelector === candidate.selector &&
    assessment.citedProperty === candidate.property &&
    assessment.citedValue.trim() === candidate.observedValue.trim()
  )
}

/**
 * The model's line, or Drift's own if the model's is unusable. A line is
 * unusable when it is empty, when it does not quote the value it is about, or
 * when it breaks the copy rules in AGENTS.md section 6. The finding is still
 * true either way, so it is not dropped over its prose.
 */
function usableSentence(
  sentence: string,
  candidate: DivergenceCandidate,
): { value: string; rewritten: boolean } {
  const cleaned = sentence.replace(/\s+/g, " ").trim()

  const usable =
    cleaned.length > 0 &&
    cleaned.length <= MAX_SENTENCE_LENGTH &&
    !cleaned.includes("—") &&
    !cleaned.includes("!") &&
    cleaned.toLowerCase().includes(candidate.observedValue.toLowerCase())

  return usable
    ? { value: cleaned, rewritten: false }
    : { value: plainSentence(candidate), rewritten: true }
}

/**
 * The evidence line Drift writes for itself: what this screen does, then what
 * its siblings do, with the counts (AGENTS.md section 6).
 */
export function plainSentence(candidate: DivergenceCandidate): string {
  const reads = profileProperty(candidate.property)?.reads ?? candidate.property
  const siblings = candidate.siblingScreenIds.length
  const plural = siblings === 1 ? "sibling screen uses" : "sibling screens use"

  return `This screen's ${reads} is ${candidate.observedValue}. ${siblings} ${plural} ${candidate.expectedValue}.`
}
