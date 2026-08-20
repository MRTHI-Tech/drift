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
  causeKeyOf,
  FINDING_KINDS,
  propertyReading,
  type FindingKind,
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

/**
 * One problem, and every screen showing it.
 *
 * A finding is per screen and stays that way: the drift really is on each one.
 * But twelve screens rendering the same wrong grey, from one default in one
 * file, is one thing to decide about, and a list that asks somebody to decide
 * it twelve times is a list they will stop reading. So the page groups what
 * actuation already groups, by the same cause key, and shows the problem once
 * with the screens it was seen on underneath.
 */
export interface FindingGroup {
  /** The sighting a person acts on. The oldest, as actuation picks it. */
  lead: FindingView
  /** Every other open sighting of the same cause. */
  others: FindingView[]
}

/** How many waiting problems each kind has, for the filter. */
export function countByKind(groups: readonly FindingGroup[]): Record<FindingKind, number> {
  const counts = Object.fromEntries(
    FINDING_KINDS.map((kind) => [kind, 0])
  ) as Record<FindingKind, number>

  for (const group of groups) {
    counts[propertyReading(group.lead.finding.evidence.property).kind] += 1
  }

  return counts
}

/** The groups of one kind, or all of them when nothing is selected. */
export function ofKind(
  groups: readonly FindingGroup[],
  kind: FindingKind | null
): FindingGroup[] {
  if (!kind) return [...groups]
  return groups.filter(
    (group) => propertyReading(group.lead.finding.evidence.property).kind === kind
  )
}

export interface FindingsPage {
  /** Waiting, grouped by cause. */
  open: FindingGroup[]
  /** How many findings those groups stand for. */
  openCount: number
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
  const open = views.filter((view) => view.finding.status === "open")

  return {
    open: groupByCause(open),
    openCount: open.length,
    settled: views.filter((view) => view.finding.status !== "open"),
  }
}

/**
 * Open findings as the problems behind them, biggest first.
 *
 * The lead is the oldest sighting, which is the one actuation fixes and the
 * one whose pull request the others will carry, so the row a person opens is
 * the row the work happened on. Groups are ordered by how many screens they
 * affect, because a value wrong on twelve screens is a bigger thing to know
 * about than one wrong on a single screen, whatever order they were raised in.
 */
export function groupByCause(views: readonly FindingView[]): FindingGroup[] {
  const causes = new Map<string, FindingView[]>()
  for (const view of views) {
    const key = causeKeyOf(view.finding)
    const group = causes.get(key)
    if (group) group.push(view)
    else causes.set(key, [view])
  }

  const groups: FindingGroup[] = []
  for (const group of causes.values()) {
    const ordered = [...group].sort(
      (left, right) =>
        left.finding.createdAt.getTime() - right.finding.createdAt.getTime() ||
        (left.finding.id < right.finding.id ? -1 : 1)
    )
    const [lead, ...others] = ordered
    if (lead) groups.push({ lead, others })
  }

  return groups.sort(
    (left, right) =>
      right.others.length - left.others.length ||
      right.lead.finding.createdAt.getTime() - left.lead.finding.createdAt.getTime()
  )
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

  return {
    ...view,
    project,
    divergent,
    siblings: await comparisonScreens(finding, divergent, archetype, project, repositories),
    archetype,
    resolutions: await repositories.resolutions.listByFinding(
      project.id,
      findingId
    ),
  }
}

/**
 * The screens a pattern finding was actually compared against.
 *
 * The finding names them, and what it names is not the same as the archetype
 * it belongs to. Against a real project it was not: an onboarding family of
 * five screens supported a convention that three of them rendered, and the
 * page showed all five under the convention's value. That said the other two
 * rendered it as well, and they did not. One of them said "Build our rhythm"
 * and the other said "Fill in the circles", both sitting under a heading
 * reading "generic", which is the opposite of what they are.
 *
 * Worse, one of the five was the screen being judged. The filter compared
 * capture ids while the list held the newest capture of each route, and the
 * finding cited an older one, so a screen appeared as evidence against itself.
 *
 * So: the screens the convention counted, in the order the evidence names
 * them, and never the route the finding is about. A finding citing nothing,
 * which is what a convention with no evidence would leave, falls back to the
 * family with its own route removed, and is still never compared to itself.
 */
async function comparisonScreens(
  finding: Finding,
  divergent: Screen | null,
  archetype: Archetype | null,
  project: Project,
  repositories: Repositories
): Promise<Screen[]> {
  const cited = finding.evidence.siblingScreenIds
  if (cited.length > 0) {
    const screens: Screen[] = []
    for (const id of cited) {
      const screen = await repositories.screens.get(id)
      if (screen && screen.route !== divergent?.route) screens.push(screen)
    }
    return screens
  }

  if (!archetype) return []

  const family = latestPerRoute(
    await repositories.screens.listByArchetype(project.id, archetype.id)
  ).filter((screen) => screen.route !== divergent?.route)

  return ordered(family, cited)
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
