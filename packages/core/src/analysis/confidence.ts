/**
 * How much of a set agrees, as one of three words.
 *
 * Lives here rather than beside either caller because both of them need it and
 * neither owns it. A screen convention counts screens and a component
 * convention counts instances, and the question "is this a standard or a
 * habit" is the same question about either.
 */

import type { Confidence } from "../types"

/**
 * A value five of six render is a standard; a value three of eight render is a
 * habit worth stating quietly.
 */
export function confidenceOf(agreeing: number, considered: number): Confidence {
  const ratio = considered === 0 ? 0 : agreeing / considered
  if (agreeing >= 4 && ratio >= 0.8) return "high"
  if (ratio >= 0.6) return "medium"
  return "low"
}
