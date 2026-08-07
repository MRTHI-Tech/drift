/**
 * Turning a signature into the one string the embedding model reads, and
 * comparing the vectors that come back. The encoding is deterministic, so the
 * same signature always embeds the same way and two runs cluster alike.
 *
 * The route is left out on purpose. Two steps of one flow live at different
 * routes and are the same kind of screen; including the path would push them
 * apart for a reason that has nothing to do with how they are designed. The
 * hashes are left out too: they are stable identifiers, not descriptions, and
 * hex noise buys an embedding nothing.
 */

import type { CopyTally, Signature } from "@drift/core"

/** The signature as the sentence an embedding model can read. */
export function signatureText(signature: Signature): string {
  return [
    `viewport: ${signature.viewport}`,
    `sections: ${signature.sectionCount}`,
    `rhythm: ${signature.verticalRhythm.join(", ") || "none"}`,
    `type: ${signature.typeHierarchy.map((step) => `${step.fontSize}/${step.fontWeight}`).join(", ") || "none"}`,
    `actions: ${signature.interactive.map((element) => `${element.tag} "${element.label}"`).join(", ") || "none"}`,
    `labels: ${tallyText(signature.copy.labels)}`,
    `headings: ${tallyText(signature.copy.headings)}`,
  ].join("\n")
}

function tallyText(tally: CopyTally): string {
  if (tally.count === 0) return "none"
  return `${tally.count} lines, ${tally.dominantCase ?? "mixed"} case, ${tally.imperative} imperative`
}

/**
 * Cosine similarity of two vectors, in -1 to 1. Returns 0 for a pair that
 * cannot be compared, which reads as "no evidence of similarity" and leaves
 * the screen unassigned rather than guessing it into a cluster.
 */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0

  let dot = 0
  let leftNorm = 0
  let rightNorm = 0

  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }

  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

/** The mean vector of a set. The point an archetype is measured from. */
export function centroid(vectors: readonly (readonly number[])[]): number[] {
  const first = vectors[0]
  if (!first) return []

  const sum = new Array<number>(first.length).fill(0)
  let counted = 0

  for (const vector of vectors) {
    if (vector.length !== first.length) continue
    for (let index = 0; index < vector.length; index += 1) {
      sum[index] = (sum[index] ?? 0) + (vector[index] ?? 0)
    }
    counted += 1
  }

  return counted === 0 ? [] : sum.map((value) => value / counted)
}
