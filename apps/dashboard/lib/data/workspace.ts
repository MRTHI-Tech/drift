/**
 * Which project the dashboard is looking at, and what the switcher says about
 * the others.
 *
 * One user with several watched projects (AGENTS.md section 1), so the current
 * project is a cookie rather than a path segment: the nav is Runs, Findings and
 * Conventions, and switching project keeps you on the page you were on.
 *
 * Every read here goes through the typed repositories in `@drift/core`. Nothing
 * on any page of this dashboard is invented, defaulted, or filled in: what is
 * on screen is what a run wrote.
 */

import {
  countOpenProblems,
  createRepositories,
  refreshDriftScore,
  type Project,
  type Repositories,
} from "@drift/core"
import { cookies } from "next/headers"

import { requireSession } from "@/lib/session"

/** Cookie holding the project the switcher last chose. */
export const PROJECT_COOKIE = "drift_project"

/** One project as the switcher lists it. */
export interface ProjectSummary {
  project: Project
  /** Findings still waiting for a decision. */
  openFindings: number
}

export interface Workspace {
  repositories: Repositories
  projects: ProjectSummary[]
  current: Project
  currentOpenFindings: number
}

/** The repository set. One per request is enough; the client underneath is cached. */
export function repositories(): Repositories {
  return createRepositories()
}

/**
 * Everything the shell needs: the projects, which one is current, and the
 * unresolved count beside each. Returns null when no project has been seeded,
 * which is a state the shell shows rather than an error.
 */
export async function loadWorkspace(): Promise<Workspace | null> {
  // The session is read here rather than passed in, so that every page is
  // scoped by construction. A page that forgot to thread a uid through would
  // be a page showing somebody else's product, and it would look fine.
  const session = await requireSession()
  const repos = repositories()

  // Only this person's. `list()` still exists for the worker and the deploy
  // webhook, which run below the session; nothing rendered may call it.
  const projects = await repos.projects.listForUser(session.uid)
  if (projects.length === 0) return null

  // A cookie is something a browser sends, so the id in it is checked against
  // this person's projects rather than looked up on its own.
  const chosen = (await cookies()).get(PROJECT_COOKIE)?.value
  const current =
    projects.find((project) => project.id === chosen) ?? projects[0]

  // Problems, not sightings. The nav badge sits beside a page whose first line
  // is a count of problems, and two numbers a person reads in one glance have
  // to be the same number.
  const summaries: ProjectSummary[] = []
  for (const project of projects) {
    const open = await repos.findings.listOpen(project.id)
    summaries.push({ project, openFindings: countOpenProblems(open) })
  }

  // The score is stored on the project and moved by the two things that move
  // it, a run and a resolution. It is checked here as well so a project seeded
  // before this page existed shows a real number rather than its initial one.
  // `refreshDriftScore` writes only when the number actually changed.
  const refreshed = await settleScore(current, repos)

  return {
    repositories: repos,
    projects: summaries.map((summary) =>
      summary.project.id === refreshed.id
        ? { ...summary, project: refreshed }
        : summary
    ),
    current: refreshed,
    currentOpenFindings:
      summaries.find((summary) => summary.project.id === current.id)
        ?.openFindings ?? 0,
  }
}

async function settleScore(
  project: Project,
  repos: Repositories
): Promise<Project> {
  try {
    const refresh = await refreshDriftScore(project.id, repos)
    return refresh.changed ? { ...project, driftScore: refresh.score } : project
  } catch {
    // A score that could not be recomputed is not a reason to fail the page.
    return project
  }
}
