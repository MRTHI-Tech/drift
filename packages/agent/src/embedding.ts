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
 *
 * The words an action is labelled with are left out for the same reason, and it
 * matters more than the route did. An archetype is a kind of screen, and what a
 * button says is not what kind of screen it is on: two steps of one flow that
 * ask different questions are still two steps of one flow. Feeding whole
 * sentences of product copy to a text embedder makes the vector mostly about
 * what the screen is asking, which is the question the convention layer exists
 * to answer later, and one an archetype must not prejudge. So an action is
 * encoded as its tag, where it sits relative to the actions around it, and how
 * wordy its label is in three buckets. That is enough to tell a column of
 * choices from a single CTA, and carries none of the copy.
 */

import type { CopyTally, InteractiveLabel, Signature } from "@drift/core"

/** The signature as the sentence an embedding model can read. */
export function signatureText(signature: Signature): string {
  return [
    `viewport: ${signature.viewport}`,
    `sections: ${signature.sectionCount}`,
    `rhythm: ${signature.verticalRhythm.join(", ") || "none"}`,
    `type: ${signature.typeHierarchy.map((step) => `${step.fontSize}/${step.fontWeight}`).join(", ") || "none"}`,
    `actions: ${tagCounts(signature.interactive)}`,
    `action rhythm: ${actionRhythm(signature.interactive).join(", ") || "none"}`,
    `action labels: ${signature.interactive.map((element) => lengthBucket(element.label)).join(", ") || "none"}`,
    `labels: ${tallyText(signature.copy.labels)}`,
    `headings: ${tallyText(signature.copy.headings)}`,
  ].join("\n")
}

/** What the screen offers, counted by tag rather than quoted. */
function tagCounts(interactive: readonly InteractiveLabel[]): string {
  if (interactive.length === 0) return "none"

  const counts = new Map<string, number>()
  for (const element of interactive) {
    counts.set(element.tag, (counts.get(element.tag) ?? 0) + 1)
  }

  return [...counts]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([tag, count]) => `${count} ${tag}`)
    .join(", ")
}

/**
 * Gaps between consecutive actions, top to bottom. A stacked column of choices
 * reads as several even gaps and a single CTA reads as none, which is the part
 * of an action's position that says what kind of screen it is on. The absolute
 * coordinates are left out: the same layout an inch further down the page is
 * the same layout.
 */
function actionRhythm(interactive: readonly InteractiveLabel[]): number[] {
  const ordered = [...interactive].sort((left, right) => left.y - right.y)

  const gaps: number[] = []
  for (let index = 1; index < ordered.length; index += 1) {
    gaps.push(Math.round((ordered[index]?.y ?? 0) - (ordered[index - 1]?.y ?? 0)))
  }

  return gaps
}

/**
 * How wordy a label is, in three buckets. A one-word CTA and a full-sentence
 * choice chip are different components; which sentence it is is not this
 * layer's question.
 */
function lengthBucket(label: string): string {
  const words = label.trim().split(/\s+/).filter((word) => word.length > 0).length

  if (words === 0) return "empty"
  if (words <= 2) return "short"
  if (words <= 5) return "medium"
  return "long"
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
