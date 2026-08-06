/** Firestore collection names, exactly as locked in AGENTS.md section 2. */
export const COLLECTIONS = {
  projects: "projects",
  runs: "runs",
  screens: "screens",
  archetypes: "archetypes",
  conventions: "conventions",
  findings: "findings",
  resolutions: "resolutions",
} as const

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS]

/** Default path to a watched project's Drift config, inside that project's repo. */
export const DEFAULT_CONFIG_PATH = "drift.config.json"

/** A convention needs this many agreeing screens before it exists at all. */
export const MIN_SCREENS_PER_CONVENTION = 3
