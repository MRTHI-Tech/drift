/**
 * The numbers the judgment phase turns on. All of them are read by
 * deterministic code; none of them is ever handed to a model to reinterpret.
 */

/**
 * Cosine similarity at which two signature embeddings count as the same kind
 * of screen. Above it a screen joins an archetype, below it the screen stays
 * unassigned and is never judged for pattern drift.
 *
 * Signatures of one flow's steps sit far above this and a different page sits
 * well below, so the exact number is not delicate. Every similarity a run
 * measures is logged under `cluster.measured`, which is how it gets tuned.
 */
export const ARCHETYPE_SIMILARITY = 0.9

/**
 * Screens a fresh cluster needs before it becomes an archetype. Set to the
 * convention floor (AGENTS.md section 2) on purpose: an archetype that could
 * never support a convention has nothing to say, so it is not worth naming.
 */
export const MIN_SCREENS_PER_ARCHETYPE = 3

/**
 * How loud a pattern finding is, by property. Fixed rather than asked for: the
 * model assesses whether a divergence matters and writes the evidence line,
 * and nothing else (AGENTS.md section 4).
 */
export const PATTERN_SEVERITY: Record<string, number> = {
  "cta.label": 3,
  "heading.size": 2,
  "cta.size": 2,
  "heading.weight": 2,
  "cta.radius": 1,
}

/** Severity of a property with no entry above. */
export const DEFAULT_PATTERN_SEVERITY = 1

/** Wait before the one retry every model call gets (AGENTS.md section 4). */
export const RETRY_BACKOFF_MS = 750

/** Longest evidence sentence kept. Past this it is a paragraph, not a line. */
export const MAX_SENTENCE_LENGTH = 240

/** Longest archetype or convention label kept. */
export const MAX_LABEL_LENGTH = 60
