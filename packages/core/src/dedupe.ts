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
