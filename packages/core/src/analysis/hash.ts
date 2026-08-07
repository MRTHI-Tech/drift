import { createHash } from "node:crypto"

/**
 * A stable hash over a value that has already been put in a canonical order.
 * JSON key order is part of what is hashed, so callers hand this arrays and
 * tuples rather than objects they built in whatever order.
 */
export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")
}
