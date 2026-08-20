import { createHash } from "node:crypto"

/**
 * The inputs a dedupe key is derived from, locked in AGENTS.md section 2:
 * `projectId + route + property + observedValue`.
 */
export interface DedupeKeyInput {
  projectId: string
  route: string
  property: string
  observedValue: string
}

/**
 * Deterministic key for a finding. Same inputs always produce the same key;
 * any changed input produces a different one. A finding whose dedupeKey
 * matches an open or resolved finding is never created again.
 *
 * Parts are length-prefixed before hashing so that no two different input
 * tuples can flatten to the same byte string.
 */
export function dedupeKey(input: DedupeKeyInput): string {
  const parts = [input.projectId, input.route, input.property, input.observedValue]
  const payload = parts.map((part) => `${part.length}:${part}`).join("")
  return createHash("sha256").update(payload, "utf8").digest("hex")
}

/**
 * The inputs that identify a cause rather than a sighting: everything a
 * dedupe key uses except the route.
 */
export interface CauseKeyInput {
  projectId: string
  property: string
  observedValue: string
  expectedValue: string
}

/**
 * Deterministic key for the problem behind a finding, as opposed to the
 * finding itself.
 *
 * A dedupe key deliberately carries the route, because the same value on two
 * screens is two sightings and both are true. A cause key deliberately drops
 * it, because the two sightings usually have one origin and therefore one fix.
 *
 * The number that made this necessary came from a real project: 26 open
 * findings, of which 12 were the same grey on 12 screens, coming from one
 * default in one file. Treated as 12 findings they are 12 questions for the
 * Fixer, 12 pull requests, and 12 copies of one line for somebody to review.
 * Treated as one cause they are one of each.
 *
 * The expected value is in the key and the route is not, so two screens
 * drifting to the same wrong value from different tokens stay separate: they
 * would need different fixes, whatever they look like.
 */
export function causeKey(input: CauseKeyInput): string {
  const parts = [input.projectId, input.property, input.observedValue, input.expectedValue]
  const payload = parts.map((part) => `${part.length}:${part}`).join("")
  return createHash("sha256").update(payload, "utf8").digest("hex")
}

/** The cause key of a finding, read off its own evidence. */
export function causeKeyOf(finding: {
  projectId: string
  evidence: { property: string; observedValue: string; expectedValue: string }
}): string {
  return causeKey({
    projectId: finding.projectId,
    property: finding.evidence.property,
    observedValue: finding.evidence.observedValue,
    expectedValue: finding.evidence.expectedValue,
  })
}

