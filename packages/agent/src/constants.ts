/**
 * The numbers the judgment phase turns on. All of them are read by
 * deterministic code; none of them is ever handed to a model to reinterpret.
 */

/**
 * Cosine similarity at which two signature embeddings count as the same kind
 * of screen. Above it a screen joins an archetype, below it the screen stays
 * unassigned and is never judged for pattern drift.
 *
 * Measured, not guessed. Over one real product's twelve mobile screens, the
 * encoding in `embedding.ts` puts the median pair at 0.888 and the closest at
 * 0.989, and the number sorts as follows:
 *
 *   0.95  two families of 4 and 3, five screens unassigned
 *   0.93  two families of 4 and 5, three screens unassigned
 *   0.88  one family of 8, and a stub screen wrongly inside it
 *   0.85  one family of 10, which is to say no families at all
 *
 * 0.93 is the last value where the families are still families. Below it the
 * clusters collapse into "every screen is the same kind of screen", which
 * states nothing; above it a family sits exactly on the convention floor, so
 * one screen moving costs it every convention it had.
 *
 * That is one project's data, so treat this as a starting point rather than a
 * constant of nature. Every similarity a run measures is logged under
 * `cluster.measured`, which is how it gets tuned against the next one.
 */
export const ARCHETYPE_SIMILARITY = 0.93

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
  "cta.voice": 3,
  "heading.tone": 3,
  "heading.size": 2,
  "cta.size": 2,
  "heading.weight": 2,
  "content.layout": 3,
  "content.padding": 2,
  "content.gap": 2,
  "content.width": 2,
  "cta.radius": 1,
}

/** Severity of a property with no entry above. */
export const DEFAULT_PATTERN_SEVERITY = 1

/**
 * What the Fixer may see in one tool call.
 *
 * Small on purpose. A fix for one finding is found by looking in one or two
 * places, and a Fixer that has read two thousand lines is one that is casting
 * about rather than working from the evidence it was handed.
 */
export const MAX_SEARCH_HITS = 30
export const MAX_READ_LINES = 200

/**
 * Tool calls the Fixer gets before it has to answer with what it has. Genkit
 * counts a turn as one model response, so this is how many times it may look
 * something up and think again.
 */
export const MAX_FIX_TURNS = 20

/** Wait before the one retry every model call gets (AGENTS.md section 4). */
export const RETRY_BACKOFF_MS = 750

/** Longest evidence sentence kept. Past this it is a paragraph, not a line. */
export const MAX_SENTENCE_LENGTH = 240

/** Longest archetype or convention label kept. */
export const MAX_LABEL_LENGTH = 60
