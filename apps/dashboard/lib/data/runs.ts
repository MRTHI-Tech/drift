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

import type { Project, Repositories, Run } from "@drift/core"

import { decorate, type FindingView } from "./findings"

export interface RunView {
  run: Run
  findings: FindingView[]
  /** Screens this run captured. */
  screensCaptured: number
  /** Pull requests this run opened without being asked. */
  autoFixes: FindingView[]
}

/** How many runs the feed shows. */
const FEED_SIZE = 30

export async function loadRuns(
  project: Project,
  repositories: Repositories
): Promise<RunView[]> {
  const runs = await repositories.runs.listByProject(project.id, FEED_SIZE)
  if (runs.length === 0) return []

  const findings = await repositories.findings.listByProject(project.id, 500)
  const views = await decorate(findings, project, repositories)

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

  return runs.map((run) => {
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
  })
}
