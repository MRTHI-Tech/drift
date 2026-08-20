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
import { propertyReading } from "../vocabulary"

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
 *
 * The property is named in English rather than in CSS. The line used to read
 * "renders rgb(242, 242, 242) for background-color", which puts a stylesheet
 * keyword in the one sentence that exists to be plain, and does it twice over
 * when the row above it already says which property this is.
 */
export function tokenSentence(finding: Finding): string {
  const { property, observedValue, expectedValue, expectedSource } = finding.evidence
  const reads = propertyReading(property).label.toLowerCase()

  const observed = `This screen's ${reads} is ${observedValue}.`
  if (!expectedSource || expectedValue.length === 0) {
    return `${observed} It is on no scale the token file declares.`
  }

  return `${observed} The nearest token is ${expectedSource} at ${expectedValue}.`
}
