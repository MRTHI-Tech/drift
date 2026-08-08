/**
 * Dismisses open token findings the current diff would no longer raise.
 *
 * Findings are never deleted (AGENTS.md section 2), so when the analysis layer
 * gets stricter about what counts as drift, the findings the old rules wrote
 * stay open and keep being counted. This walks the current screens, works out
 * what the diff says about them now, and dismisses every open token finding
 * that is no longer among the answers.
 *
 * It compares on the dedupe key, which is exactly what decides whether a run
 * would raise a finding again, so a finding this script dismisses is a finding
 * the next run would not re-raise, and one it keeps is one the next run would.
 *
 * Dismissal goes through `resolveFinding`, the same path the dashboard and the
 * worker's CLI use, so each one writes a `resolutions` document and the drift
 * score is refreshed at the end. Nothing is deleted and nothing touches GitHub.
 *
 * Reports and writes nothing unless `--apply` is given.
 *
 *   pnpm prune-findings
 *   pnpm prune-findings --apply
 *
 * Needs GOOGLE_CLOUD_PROJECT, GITHUB_TOKEN, and Google application default
 * credentials: the token file it diffs against is read from the watched repo.
 */
import { parseArgs } from "node:util"

import { diffScreenTokens } from "../src/analysis/token-diff"
import { tokenDedupeKey } from "../src/analysis/findings"
import { resolveFinding } from "../src/actuation/resolve"
import { createGitHubClient, fetchDriftConfig, fetchTokenDefinitions } from "../src/github"
import { getDriftFirestore } from "../src/firestore"
import { createRepositories, type Repositories } from "../src/repositories"
import { latestPerRoute } from "../src/analysis/screens"
import type { Finding, Project, Screen } from "../src/types"

/** How many findings are read at once. Above any run's output. */
const PAGE_SIZE = 1000

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean", default: false },
      project: { type: "string" },
    },
  })

  const repositories = createRepositories(getDriftFirestore())
  const projects = await repositories.projects.list()
  const wanted = values.project
    ? projects.filter((project) => project.id === values.project)
    : projects

  if (wanted.length === 0) {
    fail(
      values.project
        ? `There is no project ${values.project}.`
        : "No project has been seeded, so there is nothing to prune.",
    )
  }

  for (const project of wanted) {
    await pruneProject(project, repositories, values.apply === true)
  }

  if (values.apply !== true) {
    console.log("\nNothing was written. Run again with --apply to dismiss these.")
  }
}

async function pruneProject(
  project: Project,
  repositories: Repositories,
  apply: boolean,
): Promise<void> {
  console.log(`\n${project.name} (${project.repo})`)

  const current = await currentCandidateKeys(project, repositories)
  if (!current) return

  const findings = await repositories.findings.listOpen(project.id, PAGE_SIZE)
  const stale = findings.filter((finding) => isStale(finding, current))

  console.log(
    `  ${findings.length} open, ${current.keys.size} raised by the current rules, ` +
      `${stale.length} no longer raised.`,
  )

  if (stale.length === 0) return

  for (const finding of stale) {
    const { property, observedValue } = finding.evidence
    const route = current.routeOf.get(finding.screenId) ?? "unknown route"
    console.log(`  ${apply ? "dismissing" : "would dismiss"}  ${route}  ${property} = ${observedValue}`)

    if (!apply) continue

    try {
      await resolveFinding({ findingId: finding.id, action: "dismiss", repositories })
    } catch (error) {
      console.error(`  failed on ${finding.id}: ${message(error)}`)
    }
  }

  if (apply) {
    const project_ = await repositories.projects.get(project.id)
    console.log(`  drift score is now ${project_?.driftScore ?? "unknown"}.`)
  }
}

/** What the diff says about this project's screens right now. */
interface CurrentAnswers {
  /** Dedupe keys of every candidate the current rules raise. */
  keys: Set<string>
  /** Routes the diff actually ran over, so a screen it never saw is left alone. */
  routes: Set<string>
  routeOf: Map<string, string>
}

async function currentCandidateKeys(
  project: Project,
  repositories: Repositories,
): Promise<CurrentAnswers | null> {
  const github = createGitHubClient()

  const config = await fetchDriftConfig(github, project)
  if (!config.tokenDefinitionsPath) {
    console.log("  This project declares no token file, so there is nothing to compare against.")
    return null
  }

  const definitions = await fetchTokenDefinitions(github, project, config.tokenDefinitionsPath)
  if (!definitions) {
    console.log(`  ${config.tokenDefinitionsPath} could not be read, so nothing is pruned.`)
    return null
  }

  const summaries = await repositories.screens.listSummaries(project.id)
  const routeOf = new Map(summaries.map((screen) => [screen.id, screen.route]))

  const keys = new Set<string>()
  const routes = new Set<string>()

  for (const summary of latestPerRoute(summaries)) {
    const screen = await repositories.screens.get(summary.id)
    if (!screen) continue

    routes.add(screen.route)
    for (const candidate of diffScreenTokens(screen.computedStyles, definitions.tokens)) {
      keys.add(tokenDedupeKey(project.id, screen.route, candidate))
    }
  }

  return { keys, routes, routeOf }
}

/**
 * Whether the current rules have stopped raising this finding. Only token
 * findings on a route the diff just ran over are considered: a pattern finding
 * is not this diff's to judge, and a route nothing was captured for this time
 * is a route with no evidence either way.
 */
function isStale(finding: Finding, current: CurrentAnswers): boolean {
  if (finding.type !== "token") return false

  const route = current.routeOf.get(finding.screenId)
  if (route === undefined || !current.routes.has(route)) return false

  return !current.keys.has(finding.dedupeKey)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fail(text: string): never {
  console.error(text)
  process.exit(1)
}

await main().catch((error: unknown) => {
  fail(message(error))
})
