/**
 * The judgment phase of a run, end to end: classify, embed, cluster, derive,
 * judge, persist. It runs after the deterministic phases have already written
 * the screens and the token findings, and it is additive. Nothing it does can
 * unmake a fact the earlier phases established.
 *
 * It never throws. A model that is down, an archetype that will not form, a
 * screen that fits no cluster: each of those costs this phase a little of its
 * output and costs the run nothing (AGENTS.md sections 4 and 7). Every phase
 * transition is logged with the run's `runId` and `projectId`.
 */

import {
  MIN_SCREENS_PER_CONVENTION,
  latestPerRoute,
  type Archetype,
  type ComputedStyles,
  type Convention,
  type NewEntity,
  type Repositories,
  type Screen,
  type ScreenText,
} from "@drift/core"

import { archetypeCentroid, clusterScreens, type ArchetypeCentroid, type EmbeddedScreen } from "./cluster"
import { signatureText } from "./embedding"
import { classifyArchetype } from "./flows/classify-archetype"
import { deriveConventions } from "./flows/derive-conventions"
import { embedSignature } from "./flows/embed-signature"
import { judgePatternDrift } from "./flows/judge-pattern-drift"
import { errorMessage, type AgentLogger } from "./logging"
import { persistPatternFindings } from "./pattern-findings"
import { buildProfile, type ProfiledScreen } from "./profile"
import { divergenceCandidates, type DivergenceCandidate } from "./divergence"

/** One screen this run captured, with the image the model is shown. */
export interface CapturedScreen {
  screen: Screen
  screenshot: Buffer
}

export interface JudgeRunInput {
  projectId: string
  runId: string
  screens: readonly CapturedScreen[]
  repositories: Repositories
  logger: AgentLogger
}

export interface JudgeRunResult {
  /** Pattern findings this run raised. */
  findingIds: string[]
  screensClassified: number
  screensAssigned: number
  /** Screens that fit no cluster. Never judged for pattern drift. */
  screensUnassigned: number
  archetypesCreated: number
  conventionsWritten: number
  /** Findings dropped by the reconciliation gate (AGENTS.md section 3). */
  reconciliationDrops: number
  /** Model proposals naming something outside the candidate list. */
  outsideCandidateDrops: number
}

const EMPTY: JudgeRunResult = {
  findingIds: [],
  screensClassified: 0,
  screensAssigned: 0,
  screensUnassigned: 0,
  archetypesCreated: 0,
  conventionsWritten: 0,
  reconciliationDrops: 0,
  outsideCandidateDrops: 0,
}

export async function judgeRun(input: JudgeRunInput): Promise<JudgeRunResult> {
  const { logger } = input
  const signed = input.screens.filter((captured) => captured.screen.signature !== null)

  logger.log("judge.start", {
    screens: input.screens.length,
    signed: signed.length,
    unsigned: input.screens.length - signed.length,
  })

  if (signed.length === 0) {
    logger.log("judge.finish", { ...EMPTY, findingIds: 0 })
    return EMPTY
  }

  try {
    const archetypes = await input.repositories.archetypes.listByProject(input.projectId)
    const members = await loadMembers(input, archetypes)

    const embedded = await classifyAndEmbed(input, signed, archetypes)
    const placement = await placeScreens(input, embedded, archetypes, members)
    const conventions = await deriveAll(input, placement, members)
    const judged = await judgeAll(input, signed, placement, conventions)

    const result: JudgeRunResult = {
      findingIds: judged.findingIds,
      screensClassified: embedded.length,
      screensAssigned: placement.assignedTo.size,
      screensUnassigned: placement.unassigned.length,
      archetypesCreated: placement.created,
      conventionsWritten: conventions.written,
      reconciliationDrops: judged.reconciliationDrops,
      outsideCandidateDrops: judged.outsideCandidateDrops,
    }

    logger.log("judge.finish", { ...result, findingIds: result.findingIds.length })
    return result
  } catch (error) {
    // The judgment phase is additive. A failure here leaves the run's screens
    // and its token findings exactly as they were written.
    logger.error("judge.error", { message: errorMessage(error) })
    return EMPTY
  }
}

/** Screens of every existing archetype, cached so the run reads them once. */
async function loadMembers(
  input: JudgeRunInput,
  archetypes: readonly Archetype[],
): Promise<Map<string, Screen[]>> {
  const members = new Map<string, Screen[]>()

  for (const archetype of archetypes) {
    members.set(
      archetype.id,
      await input.repositories.screens.listByArchetype(input.projectId, archetype.id),
    )
  }

  return members
}

/**
 * A label from the model and a vector from the embedder, for every signed
 * screen. The vector is stored on the screen, so a later run measures against
 * it without re-embedding.
 */
async function classifyAndEmbed(
  input: JudgeRunInput,
  signed: readonly CapturedScreen[],
  archetypes: readonly Archetype[],
): Promise<EmbeddedScreen[]> {
  const existingLabels = archetypes.map((archetype) => archetype.label)
  const embedded: EmbeddedScreen[] = []

  for (const captured of signed) {
    const { screen } = captured
    const signature = screen.signature
    if (!signature) continue

    const text = signatureText(signature)

    const labelled = await classifyArchetype(
      {
        route: screen.route,
        viewport: screen.viewport,
        signature: text,
        screenshot: captured.screenshot.toString("base64"),
        existingLabels,
      },
      input.logger,
    )
    const vector = await embedSignature({ signature: text }, input.logger)

    if (vector.embedding.length > 0) {
      await input.repositories.screens.update(screen.id, { embedding: vector.embedding })
    }

    input.logger.log("classify.done", {
      screenId: screen.id,
      route: screen.route,
      viewport: screen.viewport,
      label: labelled.label || null,
      dimensions: vector.embedding.length,
    })

    embedded.push({
      screenId: screen.id,
      route: screen.route,
      viewport: screen.viewport,
      embedding: vector.embedding,
      proposedLabel: labelled.label,
    })
  }

  return embedded
}

interface Placement {
  /** Screen id to the archetype it now belongs to. */
  assignedTo: Map<string, string>
  /** Archetype id to every screen of it, this run's included. */
  membersOf: Map<string, Screen[]>
  /** Archetype id to its label, for the archetypes this run touched. */
  labels: Map<string, string>
  unassigned: string[]
  created: number
}

/**
 * Clusters and writes the result: screens join an archetype that exists, or
 * start one, or stay unassigned. An unassigned screen is left alone on purpose.
 */
async function placeScreens(
  input: JudgeRunInput,
  embedded: readonly EmbeddedScreen[],
  archetypes: readonly Archetype[],
  members: Map<string, Screen[]>,
): Promise<Placement> {
  const centroids = buildCentroids(archetypes, members)
  const outcome = clusterScreens(embedded, centroids)

  input.logger.log("cluster.measured", {
    similarities: outcome.measured,
    joined: outcome.assigned.length,
    newClusters: outcome.created.length,
    unassigned: outcome.unassigned.length,
  })

  const byId = new Map(embedded.map((screen) => [screen.screenId, screen]))
  const placement: Placement = {
    assignedTo: new Map(),
    membersOf: new Map(),
    labels: new Map(archetypes.map((archetype) => [archetype.id, archetype.label])),
    unassigned: outcome.unassigned,
    created: 0,
  }

  const screenById = new Map(input.screens.map((captured) => [captured.screen.id, captured.screen]))

  for (const assignment of outcome.assigned) {
    const screen = screenById.get(assignment.screenId)
    if (!screen) continue
    await attach(input, placement, members, assignment.archetypeId, [screen])
  }

  const labelsInUse = new Set(archetypes.map((archetype) => archetype.label))
  for (const cluster of outcome.created) {
    const screens = cluster.screenIds.flatMap((id) => {
      const screen = screenById.get(id)
      return screen ? [screen] : []
    })
    if (screens.length === 0) continue

    const label = uniqueLabel(cluster.proposedLabel, cluster.viewport, labelsInUse)
    labelsInUse.add(label)

    const archetype = await input.repositories.archetypes.create({
      projectId: input.projectId,
      label,
      screenIds: [],
      createdAt: new Date(),
    })
    placement.labels.set(archetype.id, label)
    placement.created += 1

    input.logger.log("cluster.archetype_created", {
      archetypeId: archetype.id,
      label,
      viewport: cluster.viewport,
      screens: screens.length,
    })

    await attach(input, placement, members, archetype.id, screens)
  }

  for (const screenId of outcome.unassigned) {
    const screen = byId.get(screenId)
    // Said out loud rather than left silent: an unassigned screen has no
    // siblings, so it is never judged for pattern drift.
    input.logger.log("cluster.unassigned", {
      screenId,
      route: screen?.route,
      viewport: screen?.viewport,
    })
  }

  return placement
}

/** Writes the archetype on the screens and the screens on the archetype. */
async function attach(
  input: JudgeRunInput,
  placement: Placement,
  members: Map<string, Screen[]>,
  archetypeId: string,
  screens: readonly Screen[],
): Promise<void> {
  const existing = placement.membersOf.get(archetypeId) ?? members.get(archetypeId) ?? []
  const kept = latestPerRoute([...existing, ...screens])

  for (const screen of screens) {
    await input.repositories.screens.update(screen.id, { archetypeId })
    placement.assignedTo.set(screen.id, archetypeId)
  }

  await input.repositories.archetypes.update(archetypeId, {
    screenIds: kept.map((screen) => screen.id),
  })
  placement.membersOf.set(archetypeId, kept)
}

function buildCentroids(
  archetypes: readonly Archetype[],
  members: Map<string, Screen[]>,
): ArchetypeCentroid[] {
  return archetypes.flatMap((archetype) => {
    const screens = members.get(archetype.id) ?? []
    const embeddings = screens.flatMap((screen) => (screen.embedding ? [screen.embedding] : []))
    const viewport = screens[0]?.viewport
    if (embeddings.length === 0 || !viewport) return []

    return [
      {
        archetypeId: archetype.id,
        label: archetype.label,
        viewport,
        centroid: archetypeCentroid(embeddings),
      },
    ]
  })
}

interface DerivedConventions {
  byArchetype: Map<string, Convention[]>
  written: number
}

/**
 * Re-derives every touched archetype's conventions and writes them. A
 * convention that already exists is updated in place: one archetype states a
 * property once. A convention the user removed is left removed, and the
 * exceptions on a convention are carried across untouched, because an
 * exception is a decision and decisions are respected permanently
 * (AGENTS.md section 6).
 */
async function deriveAll(
  input: JudgeRunInput,
  placement: Placement,
  members: Map<string, Screen[]>,
): Promise<DerivedConventions> {
  const byArchetype = new Map<string, Convention[]>()
  let written = 0

  for (const archetypeId of new Set(placement.assignedTo.values())) {
    const screens = placement.membersOf.get(archetypeId) ?? members.get(archetypeId) ?? []
    const label = placement.labels.get(archetypeId) ?? "Unnamed screen"
    const profiled = screens.flatMap(toProfiled)

    const derived = await deriveConventions(
      { archetypeLabel: label, screens: profiled },
      input.logger,
    )

    input.logger.log("conventions.derived", {
      archetypeId,
      label,
      screens: profiled.length,
      conventions: derived.conventions.map((convention) => ({
        property: convention.property,
        value: convention.value,
        evidence: convention.evidenceScreenIds.length,
        of: convention.consideredScreens,
        confidence: convention.confidence,
      })),
      floor: MIN_SCREENS_PER_CONVENTION,
    })

    const stored: Convention[] = []
    for (const derivedConvention of derived.conventions) {
      const convention = await upsertConvention(input, archetypeId, derivedConvention)
      if (convention) {
        stored.push(convention)
        written += 1
      }
    }

    byArchetype.set(archetypeId, stored)
  }

  return { byArchetype, written }
}

async function upsertConvention(
  input: JudgeRunInput,
  archetypeId: string,
  derived: {
    property: string
    value: string
    label: string
    confidence: Convention["confidence"]
    evidenceScreenIds: string[]
  },
): Promise<Convention | null> {
  const conventions = input.repositories.conventions
  const existing = await conventions.findByProperty(input.projectId, archetypeId, derived.property)

  if (!existing) {
    const fresh: NewEntity<Convention> = {
      projectId: input.projectId,
      archetypeId,
      property: derived.property,
      value: derived.value,
      label: derived.label,
      confidence: derived.confidence,
      evidenceScreenIds: derived.evidenceScreenIds,
      exceptions: [],
      status: "derived",
      updatedAt: new Date(),
    }
    return conventions.create(fresh)
  }

  if (existing.status === "removed") {
    input.logger.log("conventions.left_removed", {
      conventionId: existing.id,
      property: existing.property,
    })
    return null
  }

  return conventions.update(existing.id, {
    value: derived.value,
    label: derived.label,
    confidence: derived.confidence,
    evidenceScreenIds: derived.evidenceScreenIds,
    updatedAt: new Date(),
  })
}

interface JudgeAllResult {
  findingIds: string[]
  reconciliationDrops: number
  outsideCandidateDrops: number
}

/**
 * Judges every screen this run captured that has an archetype. Candidates are
 * computed first and the model only ever sees those; a screen with none never
 * reaches a model at all.
 */
async function judgeAll(
  input: JudgeRunInput,
  signed: readonly CapturedScreen[],
  placement: Placement,
  conventions: DerivedConventions,
): Promise<JudgeAllResult> {
  const findingIds: string[] = []
  let reconciliationDrops = 0
  let outsideCandidateDrops = 0

  for (const captured of signed) {
    const { screen } = captured
    const archetypeId = placement.assignedTo.get(screen.id)
    if (!archetypeId) continue

    const archetypeConventions = conventions.byArchetype.get(archetypeId) ?? []
    const profile = toProfiled(screen)[0]?.profile ?? []
    const candidates = divergenceCandidates({
      screenId: screen.id,
      profile,
      conventions: archetypeConventions,
    })

    input.logger.log("judge.candidates", {
      screenId: screen.id,
      route: screen.route,
      viewport: screen.viewport,
      archetypeId,
      candidates: candidates.map((candidate) => ({
        property: candidate.property,
        observed: candidate.observedValue,
        expected: candidate.expectedValue,
        siblings: candidate.siblingScreenIds.length,
      })),
    })

    if (candidates.length === 0) continue

    const outcome = await judgePatternDrift(
      {
        route: screen.route,
        viewport: screen.viewport,
        archetypeLabel: placement.labels.get(archetypeId) ?? "Unnamed screen",
        screenshot: captured.screenshot.toString("base64"),
        conventions: archetypeConventions.map((convention) => ({
          property: convention.property,
          value: convention.value,
          label: convention.label,
          confidence: convention.confidence,
          evidenceCount: convention.evidenceScreenIds.length,
        })),
        candidates,
        extraction: extractionSlice(screen, candidates),
      },
      input.logger,
    )

    reconciliationDrops += outcome.dropped
    outsideCandidateDrops += outcome.droppedOutsideCandidates

    // The counter AGENTS.md section 3 requires. `dropped` is findings the gate
    // refused because the value the model cited is not in this screen's record.
    input.logger.log("judge.gate", {
      screenId: screen.id,
      route: screen.route,
      candidates: candidates.length,
      proposed: outcome.proposed,
      kept: outcome.findings.length,
      immaterial: outcome.immaterial,
      dropped: outcome.dropped,
      droppedOutsideCandidates: outcome.droppedOutsideCandidates,
      sentencesRewritten: outcome.sentencesRewritten,
    })

    const persisted = await persistPatternFindings({
      findings: input.repositories.findings,
      projectId: input.projectId,
      runId: input.runId,
      screenId: screen.id,
      route: screen.route,
      judged: outcome.findings.map((finding) => ({
        candidate: finding.candidate as DivergenceCandidate,
        sentence: finding.sentence,
      })),
    })

    input.logger.log("judge.findings_written", {
      screenId: screen.id,
      created: persisted.created.length,
      alreadyKnown: persisted.alreadyKnown,
    })

    findingIds.push(...persisted.created.map((finding) => finding.id))
  }

  return { findingIds, reconciliationDrops, outsideCandidateDrops }
}

/**
 * The screen's extraction, narrowed to the elements the candidates cite. This
 * is what the reconciliation gate reads. Narrow rather than whole because a
 * value cited on an element that is not a candidate's element is out of scope
 * by definition, and because a whole screen's record is megabytes.
 */
export function extractionSlice(
  screen: Screen,
  candidates: readonly DivergenceCandidate[],
): { computedStyles: ComputedStyles; text: ScreenText } {
  const computedStyles: ComputedStyles = {}
  const text: ScreenText = {}

  for (const candidate of candidates) {
    const element = screen.computedStyles[candidate.selector]
    if (element) computedStyles[candidate.selector] = element

    const own = screen.text[candidate.selector]
    if (own !== undefined) text[candidate.selector] = own

    // A button that wraps a span renders its label from the span, so the
    // children come too or the gate would never find the words.
    const prefix = `${candidate.selector} > `
    for (const [selector, value] of Object.entries(screen.text)) {
      if (selector.startsWith(prefix)) text[selector] = value
    }
  }

  return { computedStyles, text }
}

/** One screen as the profile the derivation and the judgment both read. */
function toProfiled(screen: Screen): ProfiledScreen[] {
  if (!screen.signature) return []

  return [
    {
      screenId: screen.id,
      route: screen.route,
      profile: buildProfile({
        signature: screen.signature,
        computedStyles: screen.computedStyles,
        text: screen.text,
      }),
    },
  ]
}

/**
 * The newest capture of each route and viewport. An archetype accumulates a
 * screen per route per run, and a convention derived over six runs of the same
 * six screens would count each of them six times. Re-exported from
 * `@drift/core`, where the rules file counts screens by the same rule.
 */
export { latestPerRoute }

/**
 * An archetype label nothing else in the project is using. Clusters are formed
 * per viewport, so one product can hold the same family twice; the viewport
 * disambiguates them rather than a number nobody can read.
 */
export function uniqueLabel(
  proposed: string,
  viewport: string,
  inUse: ReadonlySet<string>,
): string {
  const base = proposed.trim().length > 0 ? proposed.trim() : "Unnamed screen"
  if (!inUse.has(base)) return base

  const withViewport = `${base} (${viewport})`
  if (!inUse.has(withViewport)) return withViewport

  for (let index = 2; index < 100; index += 1) {
    const numbered = `${withViewport} ${index}`
    if (!inUse.has(numbered)) return numbered
  }

  return `${withViewport} ${Date.now()}`
}
