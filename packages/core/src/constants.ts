import type { RunTrigger, Viewport } from "./types"

/** Firestore collection names, exactly as locked in AGENTS.md section 2. */
export const COLLECTIONS = {
  projects: "projects",
  installations: "installations",
  runs: "runs",
  screens: "screens",
  archetypes: "archetypes",
  conventions: "conventions",
  findings: "findings",
  resolutions: "resolutions",
} as const

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS]

/**
 * Every way a run can start, as a list, so the worker's `--trigger` flag and
 * anything else that has to name one derives from the type rather than
 * repeating it.
 */
export const RUN_TRIGGERS = [
  "scheduled",
  "deploy",
  "manual",
] as const satisfies readonly RunTrigger[]

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

/**
 * The two names the deployed system has to agree on with itself.
 *
 * Constants rather than environment variables, because neither end can check
 * the other: the dashboard starts the worker by naming its job, and it accepts
 * a deploy webhook only from a push signed by one particular service account.
 * `deploy.md` creates both by exactly these names. A name only one side knows
 * is a name that can drift, which would be an unfortunate property for this
 * repository to have.
 *
 * Everything else about the deployment stays in the environment (AGENTS.md
 * section 8). These are identifiers, not configuration.
 */
export const DEPLOYMENT = {
  /** Cloud Run job running `apps/worker`. */
  workerJob: "drift-worker",
  /** Service account Pub/Sub signs its push requests to the dashboard as. */
  pushServiceAccount: "drift-pubsub",
} as const
