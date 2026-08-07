/**
 * Deriving what an archetype's screens agree on. Counting, not judging: a
 * convention is the value most of a family's screens actually render, read out
 * of their profiles, and nothing here calls a model. Convention derivation is
 * not on the list of model calls in AGENTS.md section 4, and the reason is
 * this: a model asked what a family has in common will always find something.
 * Counting will not.
 *
 * Two floors apply. A value needs three or more agreeing screens before it is
 * a convention at all (AGENTS.md section 2), and it has to be the single most
 * common value: two values tied for first mean the family has not settled, so
 * there is nothing to state.
 */

import { MIN_SCREENS_PER_CONVENTION, type Confidence } from "@drift/core"

import { PROFILE_PROPERTIES, profileValue, type ProfiledScreen } from "./profile"

/** One convention as counting produced it, before it is named or stored. */
export interface ConventionProposal {
  property: string
  value: string
  confidence: Confidence
  /** The screens that render this value. Never fewer than the floor. */
  evidenceScreenIds: string[]
  /** Screens of the archetype that hold any value for the property. */
  consideredScreens: number
}

/**
 * Every convention an archetype's screens support. Screens are given in a
 * stable order and the result follows the declared property order, so the same
 * family always derives the same conventions.
 */
export function deriveConventionProposals(
  screens: readonly ProfiledScreen[],
): ConventionProposal[] {
  const proposals: ConventionProposal[] = []

  for (const property of PROFILE_PROPERTIES) {
    const holders = screens.flatMap((screen) => {
      const value = profileValue(screen.profile, property.property)
      return value ? [{ screenId: screen.screenId, value: value.value }] : []
    })
    if (holders.length === 0) continue

    const winner = plurality(holders)
    if (!winner) continue
    if (winner.screenIds.length < MIN_SCREENS_PER_CONVENTION) continue

    proposals.push({
      property: property.property,
      value: winner.value,
      confidence: confidenceOf(winner.screenIds.length, holders.length),
      evidenceScreenIds: winner.screenIds,
      consideredScreens: holders.length,
    })
  }

  return proposals
}

/**
 * The single most common value, or null when two values tie for first. A tie
 * is not a weak convention, it is the absence of one.
 */
function plurality(
  holders: readonly { screenId: string; value: string }[],
): { value: string; screenIds: string[] } | null {
  const groups = new Map<string, string[]>()
  for (const holder of holders) {
    const screens = groups.get(holder.value)
    if (screens) screens.push(holder.screenId)
    else groups.set(holder.value, [holder.screenId])
  }

  // Sorted by value so a tie is detected the same way every time.
  const ranked = [...groups].sort(([left], [right]) => (left < right ? -1 : 1))
  let best: { value: string; screenIds: string[] } | null = null
  let tied = false

  for (const [value, screenIds] of ranked) {
    if (!best || screenIds.length > best.screenIds.length) {
      best = { value, screenIds }
      tied = false
    } else if (screenIds.length === best.screenIds.length) {
      tied = true
    }
  }

  return tied ? null : best
}

/**
 * How much of the family agrees. A value five of six screens render is a
 * standard; a value three of eight render is a habit worth stating quietly.
 */
export function confidenceOf(agreeing: number, considered: number): Confidence {
  const ratio = considered === 0 ? 0 : agreeing / considered
  if (agreeing >= 4 && ratio >= 0.8) return "high"
  if (ratio >= 0.6) return "medium"
  return "low"
}

/**
 * The fallback name for a convention, used when the labelling call comes back
 * empty. Plain and specific, so an unnamed convention still reads as a
 * sentence rather than as a key (AGENTS.md section 6).
 */
export function fallbackLabel(property: string, value: string): string {
  return `${property} is ${value}`
}
