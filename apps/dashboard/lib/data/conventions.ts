/**
 * Conventions, grouped the way they were derived: by archetype, because a
 * convention is a property of a family of screens rather than of the product.
 *
 * Each row carries the screens it was measured on, so opening one shows the
 * evidence rather than restating the number, and the exceptions with the reason
 * each was accepted, because an exception is respected permanently
 * (AGENTS.md section 6) and a permanent decision should be visible.
 */

import {
  branchCommit,
  composeRulesFile,
  githubClientFor,
  latestPerRoute,
  RULES_BRANCH,
  RULES_PATH,
  type Archetype,
  type Convention,
  type Project,
  type Repositories,
  type ScreenSummary,
} from "@drift/core"

export interface ConventionException {
  screen: ScreenSummary | null
  screenId: string
  reason: string
}

export interface ConventionView {
  convention: Convention
  /** The screens the value was counted across. */
  evidence: ScreenSummary[]
  exceptions: ConventionException[]
}

export interface ArchetypeGroup {
  archetype: Archetype | null
  /** Screens in this family, one capture per route and viewport. */
  screens: ScreenSummary[]
  conventions: ConventionView[]
}

export interface ConventionsPage {
  groups: ArchetypeGroup[]
  /** Conventions holding everywhere rather than on one kind of screen. */
  productWide: ConventionView[]
}

export async function loadConventions(
  project: Project,
  repositories: Repositories
): Promise<ConventionsPage> {
  const archetypes = await repositories.archetypes.listByProject(project.id)
  const conventions = await repositories.conventions.listByProject(project.id)
  const screens = await repositories.screens.listSummaries(project.id)

  const byId = new Map(screens.map((screen) => [screen.id, screen]))
  const view = (convention: Convention): ConventionView => ({
    convention,
    evidence: convention.evidenceScreenIds.flatMap((id) => {
      const screen = byId.get(id)
      return screen ? [screen] : []
    }),
    exceptions: convention.exceptions.map((exception) => ({
      screenId: exception.screenId,
      screen: byId.get(exception.screenId) ?? null,
      reason: exception.reason,
    })),
  })

  const groups: ArchetypeGroup[] = archetypes.map((archetype) => ({
    archetype,
    screens: latestPerRoute(
      screens.filter((screen) => screen.archetypeId === archetype.id)
    ),
    conventions: conventions
      .filter((convention) => convention.archetypeId === archetype.id)
      .map(view),
  }))

  return {
    groups,
    productWide: conventions
      .filter((convention) => convention.archetypeId === null)
      .map(view),
  }
}

/** What the rules file says now, and when the watched repo last got it. */
export interface RulesFileState {
  path: string
  branch: string
  /** The file as Firestore states it right now. */
  content: string
  /** The last commit on the rules branch, or null when it has never synced. */
  lastSync: { at: Date; sha: string; url: string } | null
  /** Why the last sync could not be read. Null when it could. */
  syncError: string | null
}

/**
 * The rules file, composed from the conventions rather than fetched, so the
 * modal shows what Drift would write now. The sync time is asked of GitHub,
 * because that is where the answer actually lives (see `rules-sync.ts`), and a
 * GitHub that cannot be reached costs the card its timestamp and nothing else.
 */
export async function loadRulesFile(
  project: Project,
  repositories: Repositories
): Promise<RulesFileState> {
  const content = await composeRulesFile({ project, repositories })

  try {
    const commit = await branchCommit(githubClientFor(project.installationId), {
      repo: project.repo,
      branch: RULES_BRANCH,
    })

    return {
      path: RULES_PATH,
      branch: RULES_BRANCH,
      content,
      lastSync: commit
        ? { at: commit.committedAt, sha: commit.sha, url: commit.url }
        : null,
      syncError: null,
    }
  } catch (error) {
    return {
      path: RULES_PATH,
      branch: RULES_BRANCH,
      content,
      lastSync: null,
      syncError: error instanceof Error ? error.message : String(error),
    }
  }
}
