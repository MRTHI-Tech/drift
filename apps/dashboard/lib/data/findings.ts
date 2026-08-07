/**
 * Findings, as the pages read them.
 *
 * A finding on its own is a row of identifiers. What a person needs beside it
 * is the screen it was seen on, the convention it answers to, the one line the
 * judgment phase already wrote for it, and, once it has been resolved, where
 * the pull request went. All of that is assembled here so a page component
 * never queries.
 */

import {
  evidenceSentence,
  latestPerRoute,
  pullRequestUrl,
  type Archetype,
  type Convention,
  type Finding,
  type Project,
  type Repositories,
  type Resolution,
  type Screen,
  type ScreenSummary,
} from "@drift/core"

/** A finding with everything a row needs to state it. */
export interface FindingView {
  finding: Finding
  /** The finding in one line of plain language (AGENTS.md section 6). */
  sentence: string
  screen: ScreenSummary | null
  convention: Convention | null
  /** Where the patch went, or null when none was opened. */
  pullRequestUrl: string | null
}

/** The comparison view's whole subject: the divergent screen and its siblings. */
export interface FindingDetail extends FindingView {
  project: Project
  /** The full screen document, which carries the element boxes. */
  divergent: Screen | null
  /** Sibling screens of the same archetype, one capture each. */
  siblings: Screen[]
  archetype: Archetype | null
  /** Every decision recorded against this finding, oldest first. */
  resolutions: Resolution[]
}

export interface FindingsPage {
  open: FindingView[]
  settled: FindingView[]
}

/** How many findings a page reads at once. */
const PAGE_SIZE = 200

/** Every finding of a project, split into what is waiting and what is decided. */
export async function loadFindings(
  project: Project,
  repositories: Repositories
): Promise<FindingsPage> {
  const findings = await repositories.findings.listByProject(
    project.id,
    PAGE_SIZE
  )
  const views = await decorate(findings, project, repositories)

  return {
    open: views.filter((view) => view.finding.status === "open"),
    settled: views.filter((view) => view.finding.status !== "open"),
  }
}

/**
 * Findings with their screens and conventions attached. Both lookups are
 * batched: a run raising forty findings across six screens should read six
 * screens, not forty.
 */
export async function decorate(
  findings: readonly Finding[],
  project: Project,
  repositories: Repositories
): Promise<FindingView[]> {
  if (findings.length === 0) return []

  const screens = new Map(
    (await repositories.screens.listSummaries(project.id)).map((screen) => [
      screen.id,
      screen,
    ])
  )
  const conventions = new Map(
    (await repositories.conventions.listByProject(project.id)).map(
      (convention) => [convention.id, convention]
    )
  )

  return findings.map((finding) => ({
    finding,
    sentence: evidenceSentence(finding),
    screen: screens.get(finding.screenId) ?? null,
    convention: finding.conventionId
      ? (conventions.get(finding.conventionId) ?? null)
      : null,
    pullRequestUrl: finding.prNumber
      ? pullRequestUrl(project.repo, finding.prNumber)
      : null,
  }))
}

/**
 * One finding with the screens the comparison view puts side by side: the
 * divergent screen, and the siblings of its archetype. The siblings the
 * evidence names come first, because those are the screens the value was
 * counted across.
 */
export async function loadFindingDetail(
  findingId: string,
  project: Project,
  repositories: Repositories
): Promise<FindingDetail | null> {
  const finding = await repositories.findings.get(findingId)
  if (!finding || finding.projectId !== project.id) return null

  const [view] = await decorate([finding], project, repositories)
  if (!view) return null

  const divergent = await repositories.screens.get(finding.screenId)
  const archetype = divergent?.archetypeId
    ? await repositories.archetypes.get(divergent.archetypeId)
    : null

  const siblings = archetype
    ? latestPerRoute(
        await repositories.screens.listByArchetype(project.id, archetype.id)
      ).filter((screen) => screen.id !== finding.screenId)
    : []

  return {
    ...view,
    project,
    divergent,
    siblings: ordered(siblings, finding.evidence.siblingScreenIds),
    archetype,
    resolutions: await repositories.resolutions.listByFinding(
      project.id,
      findingId
    ),
  }
}

/** Screens the evidence cites first, then the rest of the family. */
function ordered(
  screens: readonly Screen[],
  cited: readonly string[]
): Screen[] {
  const rank = new Map(cited.map((id, index) => [id, index]))
  return [...screens].sort(
    (left, right) =>
      (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  )
}
