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

/**
 * Deterministic fingerprint of a rendered screen. Built without a model call
 * (AGENTS.md section 4). Null on a screen the signature phase has not reached.
 */
export interface Signature {
  route: string
  viewport: Viewport
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
  confidence: Confidence
  /** A convention needs 3 or more agreeing screens to exist at all. */
  evidenceScreenIds: string[]
  exceptions: ConventionException[]
  status: ConventionStatus
  updatedAt: Date
}

export interface FindingEvidence {
  property: string
  observedValue: string
  expectedValue: string
  siblingScreenIds: string[]
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
