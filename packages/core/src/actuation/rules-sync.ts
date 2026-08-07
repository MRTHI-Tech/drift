/**
 * Getting `drift.rules.md` into the watched repo, and keeping it there.
 *
 * The first time, the file arrives as a pull request: adding a file to somebody
 * else's repository is a change they should see and accept. After that the
 * branch exists, so every regeneration is a direct commit onto it, and the open
 * pull request updates itself. Merging that pull request and deleting the
 * branch is not a problem: the next regeneration finds no branch, creates one,
 * and proposes it again.
 *
 * Whether it is the first time is asked of GitHub rather than remembered in
 * Firestore, so the two can never disagree.
 *
 * A regeneration that produces exactly the file already on the branch commits
 * nothing (see `commitFiles`). Conventions are re-derived on every run, so
 * without that the branch would fill with empty commits.
 */

import type { Octokit } from "@octokit/rest"

import { latestPerRoute } from "../analysis/screens"
import { assertRepoAllowed, branchSha, commitFiles, ensureBranch, openPullRequest } from "../github"
import type { Repositories } from "../repositories"
import type { Convention, Project, Screen, Signature } from "../types"
import { OPENED_BY_DRIFT, RULES_BRANCH, RULES_PATH } from "./constants"
import { silentActuationLogger, type ActuationLogger } from "./logging"
import { renderRulesFile, type RulesArchetype } from "./rules"

export interface SyncRulesFileInput {
  octokit: Octokit
  project: Project
  repositories: Repositories
  logger?: ActuationLogger
  /** Compose the file, write nothing. */
  dryRun?: boolean
}

export interface RulesSyncResult {
  path: string
  branch: string
  /** The file as it was composed, whether or not it was written. */
  content: string
  /** True when the branch did not exist, which is the first time. */
  firstTime: boolean
  /** False when the branch already held exactly this file. */
  changed: boolean
  prNumber: number | null
  url: string | null
  /** Why nothing was written. Null when something was. */
  skipped: string | null
}

/** Regenerates the rules file and puts it where the watched repo can read it. */
export async function syncRulesFile(input: SyncRulesFileInput): Promise<RulesSyncResult> {
  const logger = input.logger ?? silentActuationLogger
  const { project } = input

  assertRepoAllowed(project.repo)

  const content = await composeRulesFile(input)

  logger.log("rules.composed", {
    projectId: project.id,
    path: RULES_PATH,
    bytes: content.length,
    lines: content.split("\n").length,
  })

  if (input.dryRun) {
    return {
      path: RULES_PATH,
      branch: RULES_BRANCH,
      content,
      firstTime: false,
      changed: false,
      prNumber: null,
      url: null,
      skipped: "Dry run. Nothing was written.",
    }
  }

  const existing = await branchSha(input.octokit, { repo: project.repo, branch: RULES_BRANCH })
  const firstTime = existing === null

  await ensureBranch(input.octokit, {
    repo: project.repo,
    branch: RULES_BRANCH,
    fromRef: project.defaultBranch,
  })

  const commit = await commitFiles(input.octokit, {
    repo: project.repo,
    branch: RULES_BRANCH,
    message: firstTime ? "Add drift.rules.md" : "Update drift.rules.md",
    files: [{ path: RULES_PATH, content }],
  })

  logger.log("rules.committed", {
    projectId: project.id,
    branch: RULES_BRANCH,
    firstTime,
    changed: commit.changed,
  })

  // Only the first arrival is proposed. After that the branch is the file's
  // home and the commits speak for themselves.
  if (!firstTime) {
    return {
      path: RULES_PATH,
      branch: RULES_BRANCH,
      content,
      firstTime,
      changed: commit.changed,
      prNumber: null,
      url: null,
      skipped: null,
    }
  }

  const pullRequest = await openPullRequest(input.octokit, {
    repo: project.repo,
    head: RULES_BRANCH,
    base: project.defaultBranch,
    title: "Add drift.rules.md",
    body: rulesPullRequestBody(),
  })

  logger.log("rules.pull_request", {
    projectId: project.id,
    prNumber: pullRequest.number,
    url: pullRequest.url,
    created: pullRequest.created,
  })

  return {
    path: RULES_PATH,
    branch: RULES_BRANCH,
    content,
    firstTime,
    changed: commit.changed,
    prNumber: pullRequest.number,
    url: pullRequest.url,
    skipped: null,
  }
}

/**
 * The rules file for one project, read straight out of Firestore. Exported on
 * its own so the file can be composed and looked at without any GitHub call.
 */
export async function composeRulesFile(input: {
  project: Project
  repositories: Repositories
}): Promise<string> {
  const { project, repositories } = input

  const archetypes = await repositories.archetypes.listByProject(project.id)
  const conventions = await repositories.conventions.listByProject(project.id)

  const routes = new Map<string, string>()
  const blocks: RulesArchetype[] = []

  for (const archetype of archetypes) {
    const screens = latestPerRoute(
      await repositories.screens.listByArchetype(project.id, archetype.id),
    )
    for (const screen of screens) routes.set(screen.id, screen.route)

    blocks.push({
      label: archetype.label,
      conventions: conventions.filter((convention) => convention.archetypeId === archetype.id),
      signatures: signaturesOf(screens),
    })
  }

  return renderRulesFile({
    projectName: project.name,
    archetypes: blocks,
    productWide: productWide(conventions),
    routes,
  })
}

function signaturesOf(screens: readonly Screen[]): Signature[] {
  return screens.flatMap((screen) => (screen.signature ? [screen.signature] : []))
}

function productWide(conventions: readonly Convention[]): Convention[] {
  return conventions.filter((convention) => convention.archetypeId === null)
}

function rulesPullRequestBody(): string {
  return [
    "This file is how Drift states what this product already does, so a coding",
    "agent working in this repo follows the product rather than its own defaults.",
    "",
    "Every rule in it was measured from rendered screens, and a rule needs three",
    "or more screens agreeing before it is written down.",
    "",
    "Drift regenerates the file whenever a convention changes and commits it",
    `straight to \`${RULES_BRANCH}\` after this pull request, so there is no second`,
    "one to review. Do not edit the file by hand; edit the conventions in Drift.",
    "",
    OPENED_BY_DRIFT,
  ].join("\n")
}
