/**
 * The drift score: how much of what Drift has looked at is still unresolved.
 *
 * One number, 0 to 100, where 100 is a product with nothing open against it.
 * It is a ratio of open problems to screens checked, and nothing else: no
 * weighting by severity, no decay over time, no opinion about which kind of
 * finding matters more. A number a person cannot reconstruct from what they can
 * see on the findings page is a number they will stop trusting, and that
 * sentence is why this file has now been changed twice.
 *
 * It used to subtract, one open finding per screen scoring zero, and against a
 * real project that turned out to mean the number never moved. MRTHI-Tech/woven
 * had 26 findings across 12 screens, so it read zero, and it would have gone on
 * reading zero until fifteen of them were resolved. A headline number that sits
 * at the floor through most of the work is worse than no number.
 *
 * It also counted sightings, while the findings page counts problems. The same
 * grey on twelve screens is one thing to fix and the page says so, so a score
 * derived from twelve was already a number nobody could reconstruct from what
 * they were looking at.
 *
 * Counted, never modelled (AGENTS.md section 4). Persisted on the project so
 * the dashboard reads one value rather than recomputing it per render, and
 * refreshed by the two things that can move it: a run raising findings and a
 * person resolving one.
 */

import { causeKeyOf } from "./dedupe"
import type { Repositories } from "./repositories"
import type { Finding, Run } from "./types"

/** The whole score, at one moment. */
export interface DriftScoreInput {
  /**
   * Problems still waiting for a decision, counted by cause: the same value
   * missing the same token on twelve screens is one.
   */
  openFindings: number
  /** Screens the project has captured, counted once per route and viewport. */
  screensChecked: number
}

/** One point of the score's history, as of one run. */
export interface DriftScorePoint {
  runId: string
  at: Date
  score: number
  openFindings: number
  screensChecked: number
}

/** Highest a score can be: nothing open against anything checked. */
export const MAX_DRIFT_SCORE = 100

/**
 * The score. Nothing open is 100, one problem per screen checked is 50, and
 * every problem after that costs less than the one before without ever
 * reaching the floor.
 *
 * Dividing rather than subtracting is the whole change. Subtracting hits zero
 * at one problem per screen and stays there however much worse things get,
 * which means it also stays there through the first half of getting better.
 * Dividing keeps moving: every problem resolved raises the number, which is
 * the only property that makes it worth putting on a wall.
 *
 * A project that has checked nothing scores 100, because nothing has been
 * found against it, and the screen count beside the score is what says how
 * little that means.
 */
export function computeDriftScore(input: DriftScoreInput): number {
  if (input.screensChecked <= 0) return MAX_DRIFT_SCORE
  if (input.openFindings <= 0) return MAX_DRIFT_SCORE

  const openPerScreen = input.openFindings / input.screensChecked
  const score = Math.round(MAX_DRIFT_SCORE / (1 + openPerScreen))

  // 100 is reserved for a project with nothing open, which is what the number
  // is documented to mean. One problem across a thousand screens rounds to it
  // otherwise, and a perfect score with something still waiting is a lie in
  // the largest text on the page.
  return Math.min(MAX_DRIFT_SCORE - 1, Math.max(0, score))
}

/** Whether a finding was still waiting for a decision at a moment in time. */
export function wasOpenAt(finding: Finding, at: Date): boolean {
  if (finding.createdAt.getTime() > at.getTime()) return false
  if (finding.resolvedAt === null) return true
  return finding.resolvedAt.getTime() > at.getTime()
}

/** Findings still waiting for a decision now. */
export function countOpen(findings: readonly Finding[]): number {
  return findings.filter((finding) => finding.status === "open").length
}

/**
 * Open problems, counted by cause rather than by sighting. The same value
 * missing the same token on twelve screens is one problem, which is what the
 * findings page shows and therefore what the score has to agree with.
 */
export function countOpenProblems(findings: readonly Finding[]): number {
  const causes = new Set<string>()
  for (const finding of findings) {
    if (finding.status !== "open") continue
    causes.add(causeKeyOf(finding))
  }
  return causes.size
}

/**
 * The score as it stood at the end of each run, oldest first.
 *
 * Reconstructed rather than remembered: a finding carries when it was raised
 * and when it was resolved, so what was open at any past moment is a fact about
 * the findings collection rather than a snapshot somebody had to think to
 * write. That is what makes the sparkline real history and not a redrawing of
 * today's number.
 *
 * A run that captured no screens, which is what an error run looks like, is
 * scored against the last count that was not zero, so a failed render reads as
 * a flat line rather than a jump to a perfect score.
 */
export function driftScoreSeries(
  runs: readonly Run[],
  findings: readonly Finding[],
  screensByRun: ReadonlyMap<string, number>,
): DriftScorePoint[] {
  const chronological = [...runs].sort(
    (left, right) => left.startedAt.getTime() - right.startedAt.getTime(),
  )

  let carried = 0
  const points: DriftScorePoint[] = []

  for (const run of chronological) {
    const at = run.finishedAt ?? run.startedAt
    const captured = screensByRun.get(run.id) ?? 0
    const screensChecked = captured > 0 ? captured : carried
    carried = screensChecked

    // Problems, not sightings, so a point on the sparkline means the same
    // thing as the number printed above it.
    const openAt = findings.filter((finding) => wasOpenAt(finding, at))
    const openFindings = new Set(openAt.map((finding) => causeKeyOf(finding))).size

    points.push({
      runId: run.id,
      at,
      score: computeDriftScore({ openFindings, screensChecked }),
      openFindings,
      screensChecked,
    })
  }

  return points
}

/** What a refresh worked out, and whether it had to write anything. */
export interface DriftScoreRefresh extends DriftScoreInput {
  score: number
  /** False when the project already carried this score. */
  changed: boolean
}

/**
 * Recomputes a project's score and stores it, writing only when it moved. The
 * dashboard reads `driftScore` off the project, so this is what makes the
 * number on screen tick when a finding is resolved.
 */
export async function refreshDriftScore(
  projectId: string,
  repositories: Repositories,
): Promise<DriftScoreRefresh> {
  const project = await repositories.projects.get(projectId)
  if (!project) {
    throw new Error(`There is no project ${projectId} to score.`)
  }

  const open = await repositories.findings.listOpen(projectId)
  const screens = await repositories.screens.listSummaries(projectId)

  const input: DriftScoreInput = {
    openFindings: countOpenProblems(open),
    screensChecked: distinctScreens(screens),
  }
  const score = computeDriftScore(input)

  if (score === project.driftScore) {
    return { ...input, score, changed: false }
  }

  await repositories.projects.update(projectId, { driftScore: score })
  return { ...input, score, changed: true }
}

/** Screens counted once per route and viewport, however often they were rendered. */
function distinctScreens(
  screens: readonly { route: string; viewport: string }[],
): number {
  return new Set(screens.map((screen) => `${screen.route}|${screen.viewport}`)).size
}
