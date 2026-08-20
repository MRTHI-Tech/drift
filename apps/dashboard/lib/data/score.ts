/**
 * The drift score and its history, for the nav footer.
 *
 * The number is read off the project, where it is stored. The line beside it is
 * reconstructed from the runs and the findings: a finding records when it was
 * raised and when it was resolved, so the score at the end of any past run is a
 * fact rather than a snapshot somebody had to remember to write.
 */

import {
  countOpenProblems,
  driftScoreSeries,
  type DriftScorePoint,
  type Project,
  type Repositories,
} from "@drift/core"

export interface ScoreTrend {
  score: number
  openFindings: number
  screensChecked: number
  /** Oldest run first. Empty until a project has run twice. */
  points: DriftScorePoint[]
}

/** How many runs back the sparkline reaches. */
const TREND_RUNS = 20

export async function loadScoreTrend(
  project: Project,
  repositories: Repositories
): Promise<ScoreTrend> {
  const runs = await repositories.runs.listByProject(project.id, TREND_RUNS)
  const findings = await repositories.findings.listByProject(project.id, 500)
  const screens = await repositories.screens.listSummaries(project.id)

  const screensByRun = new Map<string, number>()
  for (const screen of screens) {
    screensByRun.set(screen.runId, (screensByRun.get(screen.runId) ?? 0) + 1)
  }

  const distinct = new Set(
    screens.map((screen) => `${screen.route}|${screen.viewport}`)
  ).size

  return {
    score: project.driftScore,
    // Problems, so the footer, the nav badge and the score itself are all
    // counting the same thing.
    openFindings: countOpenProblems(findings),
    screensChecked: distinct,
    points: driftScoreSeries(runs, findings, screensByRun),
  }
}
