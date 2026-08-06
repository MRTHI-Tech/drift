/**
 * Single source of truth for Drift's shared types.
 * Mirrors the Firestore schema in AGENTS.md section 2. Schema changes require
 * updating AGENTS.md in the same commit.
 */

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

/** Resolved CSS values keyed by selector, then by property. */
export type ComputedStyles = Record<string, Record<string, string>>

/**
 * Deterministic fingerprint of a rendered screen. Built without a model call
 * (AGENTS.md section 4). Filled in by the signature phase.
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
  screenshotPath: string
  computedStyles: ComputedStyles
  signature: Signature
  archetypeId: string | null
  embedding: number[]
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
