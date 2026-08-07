/**
 * The one line a finding reads as, wherever it is shown.
 *
 * A pattern finding already carries one: the judgment phase wrote it after the
 * value it cites passed the reconciliation gate, and that line is used exactly
 * as stored. A token finding carries none, because there was nothing for a
 * model to say about it, so Drift writes the line itself from the value and the
 * token it missed.
 *
 * Both follow AGENTS.md section 6: plain, specific, evidence first, sentence
 * case, with the exact values named.
 */

import type { Finding } from "../types"

/** The finding's own line, or Drift's own when it has none. */
export function evidenceSentence(finding: Finding): string {
  const stored = finding.evidence.sentence?.trim()
  if (stored && stored.length > 0) return stored

  return tokenSentence(finding)
}

/**
 * A token finding as one line: what the screen renders, and the token it sits
 * nearest to. Never says the value is wrong, only what it is and what the scale
 * declares.
 */
export function tokenSentence(finding: Finding): string {
  const { property, observedValue, expectedValue, expectedSource } = finding.evidence

  const observed = `This screen renders ${observedValue} for ${property}.`
  if (!expectedSource || expectedValue.length === 0) {
    return `${observed} It is on no scale the token file declares.`
  }

  return `${observed} The nearest token is ${expectedSource} at ${expectedValue}.`
}
