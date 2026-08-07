/**
 * Placing embedded screens into archetypes. Pure and deterministic: the model
 * proposes a name for a family of screens, but which screens are a family is
 * decided here, by distance.
 *
 * A screen that is near an archetype joins it. A screen that is near enough
 * other unassigned screens starts a new one, if there are enough of them to be
 * a family at all. A screen that is near nothing stays unassigned, and an
 * unassigned screen is never judged for pattern drift: there is nothing to
 * compare it against, and comparing it against everything would be inventing a
 * standard rather than finding one.
 *
 * Screens are only ever compared within one viewport. A route at 390px and the
 * same route at 1440px are different layouts with different type sizes, and a
 * convention derived across both would be an average of two designs rather
 * than either one.
 */

import type { Viewport } from "@drift/core"

import { ARCHETYPE_SIMILARITY, MIN_SCREENS_PER_ARCHETYPE } from "./constants"
import { centroid, cosineSimilarity } from "./embedding"

/** One screen, embedded and waiting to be placed. */
export interface EmbeddedScreen {
  screenId: string
  route: string
  viewport: Viewport
  embedding: number[]
  /** What the model called this screen. Used to name a new archetype. */
  proposedLabel: string
}

/** An archetype that already exists, with the point it is measured from. */
export interface ArchetypeCentroid {
  archetypeId: string
  label: string
  viewport: Viewport
  centroid: number[]
}

/** One screen placed into an archetype that already exists. */
export interface Assignment {
  screenId: string
  archetypeId: string
  similarity: number
}

/** A family of screens with no archetype yet. */
export interface NewCluster {
  /** Screens of the cluster, in the order they were given. */
  screenIds: string[]
  viewport: Viewport
  /** The label most of its members were given, ties broken alphabetically. */
  proposedLabel: string
}

export interface ClusterResult {
  assigned: Assignment[]
  created: NewCluster[]
  /** Screens that fit nothing. Never judged for pattern drift. */
  unassigned: string[]
  /** Every similarity measured, for the log line that tunes the threshold. */
  measured: { screenId: string; archetypeId: string | null; similarity: number }[]
}

/**
 * Places every screen. Existing archetypes win over new clusters, so a run
 * never splits a family that is already named.
 */
export function clusterScreens(
  screens: readonly EmbeddedScreen[],
  archetypes: readonly ArchetypeCentroid[],
  threshold = ARCHETYPE_SIMILARITY,
): ClusterResult {
  const assigned: Assignment[] = []
  const measured: ClusterResult["measured"] = []
  const leftover: EmbeddedScreen[] = []

  for (const screen of screens) {
    if (screen.embedding.length === 0) {
      leftover.push(screen)
      continue
    }

    const nearest = nearestArchetype(screen, archetypes)
    measured.push({
      screenId: screen.screenId,
      archetypeId: nearest?.archetypeId ?? null,
      similarity: round(nearest?.similarity ?? 0),
    })

    if (nearest && nearest.similarity >= threshold) {
      assigned.push({
        screenId: screen.screenId,
        archetypeId: nearest.archetypeId,
        similarity: round(nearest.similarity),
      })
    } else {
      leftover.push(screen)
    }
  }

  const { created, unassigned } = growClusters(leftover, threshold)
  return { assigned, created, unassigned, measured }
}

function nearestArchetype(
  screen: EmbeddedScreen,
  archetypes: readonly ArchetypeCentroid[],
): { archetypeId: string; similarity: number } | null {
  let best: { archetypeId: string; similarity: number } | null = null

  for (const archetype of archetypes) {
    if (archetype.viewport !== screen.viewport) continue
    if (archetype.centroid.length === 0) continue

    const similarity = cosineSimilarity(screen.embedding, archetype.centroid)
    if (!best || similarity > best.similarity) {
      best = { archetypeId: archetype.archetypeId, similarity }
    }
  }

  return best
}

/**
 * Grows clusters out of what is left, one seed at a time in the given order.
 * A seed takes every unclaimed screen within the threshold of it; the group
 * becomes an archetype only if it reaches the floor, and otherwise its members
 * go back to being unassigned rather than being forced together.
 */
function growClusters(
  screens: readonly EmbeddedScreen[],
  threshold: number,
): { created: NewCluster[]; unassigned: string[] } {
  const created: NewCluster[] = []
  const unassigned: string[] = []
  const claimed = new Set<string>()

  for (const seed of screens) {
    if (claimed.has(seed.screenId) || seed.embedding.length === 0) continue

    const members = screens.filter(
      (candidate) =>
        !claimed.has(candidate.screenId) &&
        candidate.viewport === seed.viewport &&
        candidate.embedding.length > 0 &&
        cosineSimilarity(seed.embedding, candidate.embedding) >= threshold,
    )

    if (members.length < MIN_SCREENS_PER_ARCHETYPE) continue

    for (const member of members) claimed.add(member.screenId)
    created.push({
      screenIds: members.map((member) => member.screenId),
      viewport: seed.viewport,
      proposedLabel: commonLabel(members),
    })
  }

  for (const screen of screens) {
    if (!claimed.has(screen.screenId)) unassigned.push(screen.screenId)
  }

  return { created, unassigned }
}

/** The label most members were given. A tie goes to the first alphabetically. */
function commonLabel(members: readonly EmbeddedScreen[]): string {
  const counts = new Map<string, number>()
  for (const member of members) {
    const label = member.proposedLabel.trim()
    if (label.length === 0) continue
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  let best: { label: string; count: number } | null = null
  for (const [label, count] of [...counts].sort(([left], [right]) => (left < right ? -1 : 1))) {
    if (!best || count > best.count) best = { label, count }
  }

  return best?.label ?? "Unnamed screen"
}

/** The centroid of an archetype's members, ready to measure the next run against. */
export function archetypeCentroid(embeddings: readonly (readonly number[])[]): number[] {
  return centroid(embeddings)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
