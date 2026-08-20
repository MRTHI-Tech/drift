/**
 * Runs, as the feed reads them.
 *
 * A run document says when it started, what set it off, how many routes it got
 * through, and how it ended. The feed adds what it raised, which is a join
 * across the findings collection done once for the whole page rather than once
 * per run.
 *
 * The auto-fix rows are the pull requests nobody asked for: a finding carrying
 * a `prNumber` while still open was opened by the autonomy boundary during the
 * run, because the only other thing that opens one is a person resolving the
 * finding, and that leaves it resolved.
 */

import type { Project, Repositories, Run, RunStatus } from "@drift/core"

import { decorate, groupByCause, type FindingGroup, type FindingView } from "./findings"

export interface RunView {
  run: Run
  findings: FindingView[]
  /** Screens this run captured. */
  screensCaptured: number
  /** Pull requests this run opened without being asked. */
  autoFixes: FindingView[]
}

export interface RunsFeed {
  /** The window, newest first. */
  runs: RunView[]
  /**
   * Runs older than the window that raised something still waiting, newest
   * first. Empty when the window already reaches them.
   */
  origins: RunView[]
  /** What is still waiting, grouped by cause, as the findings page groups it. */
  standing: FindingGroup[]
  /** How many findings those groups stand for. */
  standingCount: number
}

/**
 * How many runs ended each way, counted across the window and the runs reached
 * back for.
 *
 * Both, because the outcome a person filters for is usually the one the window
 * has none of. A filter offering "raised something" as zero while three such
 * runs sit further down the page would be the same silence this page is trying
 * to break.
 */
export function countByOutcome(feed: RunsFeed): Record<RunStatus, number> {
  const counts: Record<RunStatus, number> = { clean: 0, findings: 0, error: 0 }
  for (const view of [...feed.runs, ...feed.origins]) counts[view.run.status] += 1
  return counts
}

/** The runs that ended one way, or all of them when nothing is selected. */
export function ofOutcome(
  views: readonly RunView[],
  outcome: RunStatus | null
): RunView[] {
  if (!outcome) return [...views]
  return views.filter((view) => view.run.status === outcome)
}

/** How many runs the feed shows. */
const FEED_SIZE = 30

/**
 * How many runs outside the window the feed will reach back for.
 *
 * Bounded by the distinct runs among open findings, which is small and gets
 * smaller as they are answered. The cap is there so a project that has never
 * resolved anything cannot turn this into an unbounded read.
 */
const ORIGIN_LIMIT = 10

export async function loadRuns(
  project: Project,
  repositories: Repositories
): Promise<RunsFeed> {
  const empty: RunsFeed = { runs: [], origins: [], standing: [], standingCount: 0 }

  const runs = await repositories.runs.listByProject(project.id, FEED_SIZE)
  if (runs.length === 0) return empty

  const findings = await repositories.findings.listByProject(project.id, 500)
  const views = await decorate(findings, project, repositories)
  const open = views.filter((view) => view.finding.status === "open")

  const byRun = new Map<string, FindingView[]>()
  for (const view of views) {
    const held = byRun.get(view.finding.runId)
    if (held) held.push(view)
    else byRun.set(view.finding.runId, [view])
  }

  const screens = await repositories.screens.listSummaries(project.id)
  const captured = new Map<string, number>()
  for (const screen of screens) {
    captured.set(screen.runId, (captured.get(screen.runId) ?? 0) + 1)
  }

  const toView = (run: Run): RunView => {
    const raised = byRun.get(run.id) ?? []
    return {
      run,
      findings: raised,
      screensCaptured: captured.get(run.id) ?? 0,
      autoFixes: raised.filter(
        (view) =>
          view.finding.prNumber !== null && view.finding.status === "open"
      ),
    }
  }

  return {
    runs: runs.map(toView),
    origins: (await loadOrigins(runs, open, repositories)).map(toView),
    standing: groupByCause(open),
    standingCount: open.length,
  }
}

/**
 * The runs that raised what is still waiting, when the window does not reach
 * them.
 *
 * A problem is raised once and then never again, because a value already
 * raised on a route is not raised again whatever was decided about it. So the
 * run behind a standing problem is a single run, and after a few weeks of
 * runs that raise nothing new it has fallen off the end of the feed. Left
 * alone the tab is a wall of runs reporting nothing new with no way back to
 * the thing they are being quiet about, which is the one thing a person came
 * to the page to find.
 */
async function loadOrigins(
  window: readonly Run[],
  open: readonly FindingView[],
  repositories: Repositories
): Promise<Run[]> {
  const inWindow = new Set(window.map((run) => run.id))
  const missing = [...new Set(open.map((view) => view.finding.runId))]
    .filter((runId) => !inWindow.has(runId))
    .slice(0, ORIGIN_LIMIT)
  if (missing.length === 0) return []

  const found = await Promise.all(missing.map((runId) => repositories.runs.get(runId)))
  return found
    .flatMap((run) => (run ? [run] : []))
    .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())
}
