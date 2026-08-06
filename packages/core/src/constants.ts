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

/** Pixel size each viewport renders at. Fixed, so two runs are comparable. */
export const VIEWPORT_SIZES = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const satisfies Record<Viewport, { width: number; height: number }>

/**
 * The resolved CSS properties the extractor records for every visible element.
 * Order is fixed so two extractions of the same screen serialise identically.
 * Adding one changes every stored screen's shape: update AGENTS.md section 2
 * in the same commit.
 */
export const STYLE_PROPERTIES = [
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "line-height",
  "margin",
  "padding",
  "border-radius",
  "box-shadow",
] as const

export type StyleProperty = (typeof STYLE_PROPERTIES)[number]

/** Default path to a watched project's Drift config, inside that project's repo. */
export const DEFAULT_CONFIG_PATH = "drift.config.json"

/** Branch a watched repo is compared against when the project does not say otherwise. */
export const DEFAULT_BRANCH = "main"

/** A convention needs this many agreeing screens before it exists at all. */
export const MIN_SCREENS_PER_CONVENTION = 3
