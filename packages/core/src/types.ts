/**
 * Single source of truth for Drift's shared types.
 * Mirrors the Firestore schema in AGENTS.md section 2. Schema changes require
 * updating AGENTS.md in the same commit.
 */

import type { StyleProperty } from "./constants"

export type Viewport = "mobile" | "desktop"

export type RunTrigger = "scheduled" | "deploy" | "manual"

export type RunStatus = "clean" | "findings" | "error"

export type FindingType = "token" | "pattern"

export type FindingStatus =
  | "open"
  | "resolved_conform"
  | "resolved_update_siblings"
  | "resolved_exception"
  | "dismissed"

export type Confidence = "low" | "medium" | "high"

export type ConventionStatus = "derived" | "promoted" | "removed"

/** Axis-aligned box of an element, in CSS pixels relative to the document. */
export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

/** The resolved CSS properties recorded for one element. */
export type StyleValues = Record<StyleProperty, string>

/** One visible element as the extractor recorded it. */
export interface ElementStyles {
  /** Lowercase tag name, for example `button`. */
  tag: string
  box: BoundingBox
  styles: StyleValues
}

/**
 * Every visible element of a screen, keyed by the stable selector the
 * extractor built for it. The reconciliation gate (AGENTS.md section 3) reads
 * observed values out of this record and nowhere else.
 */
export type ComputedStyles = Record<string, ElementStyles>

/**
 * Visible text of each element, keyed by the same selector as
 * `ComputedStyles`. Only an element's own text nodes, so an ancestor never
 * repeats what its children say. Elements with no text of their own are absent.
 */
export type ScreenText = Record<string, string>

/** How a line of copy is capitalised. */
export type CopyCase = "sentence" | "title" | "upper" | "lower" | "other"

/**
 * How a set of lines is written, counted rather than concluded from. Whether a
 * screen breaks the product's copy convention is a judgment, and judgments
 * belong to the model phase; this is only the evidence it reads.
 */
export interface CopyTally {
  count: number
  sentence: number
  title: number
  upper: number
  lower: number
  other: number
  /** Lines that open with an imperative verb. */
  imperative: number
  /** The case more than half the lines are in, or null when none is. */
  dominantCase: CopyCase | null
}

/** One thing the screen offers the user, and where it sits. */
export interface InteractiveLabel {
  selector: string
  tag: string
  label: string
  /** Document position in CSS pixels, rounded. */
  x: number
  y: number
}

/** One step of the rendered type hierarchy. */
export interface TypeStep {
  /** Resolved size in CSS pixels. */
  fontSize: number
  fontWeight: number
}

/** Copy flags, tallied separately for what the screen offers and what it says. */
export interface CopyFlags {
  labels: CopyTally
  headings: CopyTally
}

/**
 * Deterministic fingerprint of a rendered screen. Built without a model call
 * (AGENTS.md section 4). Null on a screen the signature phase has not reached.
 */
export interface Signature {
  route: string
  viewport: Viewport
  /** Interactive labels with their positions, top to bottom. */
  interactive: InteractiveLabel[]
  /** Rendered type hierarchy as ordered size and weight pairs, top to bottom. */
  typeHierarchy: TypeStep[]
  /** Bands of content the screen divides into. */
  sectionCount: number
  /** Gaps in pixels between those bands, top to bottom. */
  verticalRhythm: number[]
  copy: CopyFlags
  /** Stable hash over the structural shape of the screen. */
  structureHash: string
  /** Stable hash over the resolved token values used by the screen. */
  tokenHash: string
}

export interface Project {
  id: string
  name: string
  /** owner/name */
  repo: string
  previewUrl: string
  defaultBranch: string
  /** Defaults to `drift.config.json`. */
  configPath: string
  createdAt: Date
  /** 0 to 100. */
  driftScore: number
  lastRunAt: Date | null
}

export interface Run {
  id: string
  projectId: string
  trigger: RunTrigger
  startedAt: Date
  finishedAt: Date | null
  routesChecked: number
  status: RunStatus
  findingIds: string[]
  error: string | null
}

export interface Screen {
  id: string
  projectId: string
  route: string
  viewport: Viewport
  runId: string
  /** `gs://bucket/object` of the full-page PNG. */
  screenshotPath: string
  computedStyles: ComputedStyles
  text: ScreenText
  /** Null until the signature phase runs. */
  signature: Signature | null
  archetypeId: string | null
  /** Null until the embedding phase runs. */
  embedding: number[] | null
  capturedAt: Date
}

/**
 * A screen without its extraction record. Not a collection of its own: it is a
 * projection of `Screen` onto the fields that say which page this is and when
 * it was captured. A `screens` document carries every resolved style and every
 * visible string of a rendered page, so anything only needing to know which
 * pages exist reads these instead of loading all of that.
 */
export type ScreenSummary = Pick<
  Screen,
  "id" | "projectId" | "runId" | "route" | "viewport" | "archetypeId" | "screenshotPath" | "capturedAt"
>

export interface Archetype {
  id: string
  projectId: string
  /** Model-proposed, user-editable. */
  label: string
  screenIds: string[]
  createdAt: Date
}

export interface ConventionException {
  screenId: string
  reason: string
}

export interface Convention {
  id: string
  projectId: string
  /** Null for product-wide conventions. */
  archetypeId: string | null
  /** For example `cta.label`, `heading.size`, `copy.case`. */
  property: string
  value: string
  /** Model-written, user-editable line naming the convention in plain language. */
  label: string
  confidence: Confidence
  /** A convention needs 3 or more agreeing screens to exist at all. */
  evidenceScreenIds: string[]
  exceptions: ConventionException[]
  status: ConventionStatus
  updatedAt: Date
}

export interface FindingEvidence {
  /** Stable selector of the element the value was seen on. Null when the
   * finding is about the screen rather than one element. */
  selector: string | null
  property: string
  observedValue: string
  expectedValue: string
  /** Name of the token or convention the expected value comes from, or null. */
  expectedSource: string | null
  siblingScreenIds: string[]
  /**
   * The one-line reading of this evidence, in plain language. Written by the
   * judgment phase for a pattern finding, after the value it cites has passed
   * the reconciliation gate. Null on a token finding, whose evidence is the
   * value and the token alone.
   */
  sentence: string | null
}

export interface Finding {
  id: string
  projectId: string
  runId: string
  type: FindingType
  screenId: string
  /** Null for token findings. */
  conventionId: string | null
  evidence: FindingEvidence
  severity: number
  status: FindingStatus
  /** Deterministic from projectId + route + property + observedValue. */
  dedupeKey: string
  prNumber: number | null
  createdAt: Date
  resolvedAt: Date | null
}

export interface Resolution {
  id: string
  projectId: string
  findingId: string
  action: FindingStatus
  resultingConventionChange: string | null
  createdAt: Date
}
