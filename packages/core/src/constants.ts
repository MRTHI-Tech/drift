import type { Viewport } from "./types"

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

/** Every viewport a route can be rendered at, in the order runs use. */
export const VIEWPORTS = ["mobile", "desktop"] as const satisfies readonly Viewport[]

/** Default path to a watched project's Drift config, inside that project's repo. */
export const DEFAULT_CONFIG_PATH = "drift.config.json"

/** Branch a watched repo is compared against when the project does not say otherwise. */
export const DEFAULT_BRANCH = "main"

/** A convention needs this many agreeing screens before it exists at all. */
export const MIN_SCREENS_PER_CONVENTION = 3
