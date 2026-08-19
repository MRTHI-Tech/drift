/**
 * Opening one pull request for one finding.
 *
 * The order matters. The allowlist is checked before anything reaches the
 * network, the patch is planned before a branch exists, and the finding only
 * learns its `prNumber` once GitHub has actually answered with one. A run that
 * dies halfway through therefore leaves either nothing or a branch nobody
 * proposed, and never a finding claiming a pull request that is not there.
 *
 * The before and after images are committed to a branch that is never merged
 * and never proposed, so the pull request itself contains the patch and only
 * the patch. Losing them costs the body its pictures and nothing else.
 */

import type { Octokit } from "@octokit/rest"

import {
  assertRepoAllowed,
  commitFiles,
  ensureBranch,
  fetchSourceFiles,
  openPullRequest,
  rawFileUrl,
  type SourceFile,
} from "../github"
import type { Repositories } from "../repositories"
import { downloadScreenshot } from "../storage"
import type { Finding, Project, Screen } from "../types"
import { EVIDENCE_BRANCH, EVIDENCE_DIRECTORY, fixBranchName } from "./constants"
import { actuationError, silentActuationLogger, type ActuationLogger } from "./logging"
import { planFindingPatch, type PatchDirection, type PatchPlan } from "./patch"
import {
  commitMessage,
  pullRequestBody,
  pullRequestTitle,
  type ComposeInput,
  type EvidenceImage,
  type Opener,
} from "./pr"

export interface OpenFixPullRequestInput {
  octokit: Octokit
  project: Project
  finding: Finding
  direction: PatchDirection
  opener: Opener
  repositories: Repositories
  /** Plan against these rather than fetching the repo again. */
  sourceFiles?: readonly SourceFile[]
  /**
   * Use this plan rather than planning one. The Fixer's plan arrives this way:
   * it has already been through the fix gate, and re-planning it mechanically
   * here would throw away the only version of it that exists.
   */
  plan?: PatchPlan
  logger?: ActuationLogger
  /** Plan everything, write nothing, anywhere. */
  dryRun?: boolean
}

export interface PullRequestResult {
  opened: boolean
  number: number | null
  url: string | null
  branch: string
  plan: PatchPlan
  /** Why nothing was opened. Null when something was. */
  skipped: string | null
}

export async function openFixPullRequest(
  input: OpenFixPullRequestInput,
): Promise<PullRequestResult> {
  const logger = input.logger ?? silentActuationLogger
  const { project, finding } = input
  const branch = fixBranchName(finding.id)

  // The hard gate, before a single request leaves the process. Repeated here
  // as well as inside every write in github.ts, because the cost of one
  // missing check is a pull request on a stranger's repository.
  assertRepoAllowed(project.repo)

  const screen = await input.repositories.screens.get(finding.screenId)
  if (!screen) {
    return skip(branch, emptyPlan(input.direction, finding), "The screen this finding cites is gone.")
  }

  const files =
    input.sourceFiles ??
    (await fetchSourceFiles(input.octokit, { repo: project.repo, ref: project.defaultBranch }))
  const plan = input.plan ?? planFindingPatch(finding, input.direction, files)

  logger.log("actuate.planned", {
    findingId: finding.id,
    direction: input.direction,
    kind: plan.kind,
    from: plan.from,
    to: plan.to,
    author: plan.author,
    occurrences: plan.occurrences,
    files: plan.files.map((file) => file.path),
    blocked: plan.blocked,
    sourceFiles: files.length,
  })

  if (plan.blocked !== null) return skip(branch, plan, plan.blocked)
  if (input.dryRun) return skip(branch, plan, "Dry run. Nothing was written.")

  const images = await uploadEvidence({ ...input, screen, logger })

  const compose: ComposeInput = {
    finding,
    plan,
    route: screen.route,
    viewport: screen.viewport,
    direction: input.direction,
    before: images.before,
    after: images.after,
    opener: input.opener,
  }

  await ensureBranch(input.octokit, {
    repo: project.repo,
    branch,
    fromRef: project.defaultBranch,
  })

  const commit = await commitFiles(input.octokit, {
    repo: project.repo,
    branch,
    message: commitMessage(compose),
    files: plan.files.map((file) => ({ path: file.path, content: file.after })),
  })
  logger.log("actuate.committed", { findingId: finding.id, branch, changed: commit.changed })

  const pullRequest = await openPullRequest(input.octokit, {
    repo: project.repo,
    head: branch,
    base: project.defaultBranch,
    title: pullRequestTitle(compose),
    body: pullRequestBody(compose),
    draft: plan.author === "model",
  })

  await input.repositories.findings.update(finding.id, { prNumber: pullRequest.number })

  logger.log("actuate.pull_request", {
    findingId: finding.id,
    repo: project.repo,
    branch,
    prNumber: pullRequest.number,
    url: pullRequest.url,
    created: pullRequest.created,
  })

  return {
    opened: true,
    number: pullRequest.number,
    url: pullRequest.url,
    branch,
    plan,
    skipped: null,
  }
}

interface EvidencePair {
  before: EvidenceImage | null
  after: EvidenceImage | null
}

/**
 * The two images the body embeds.
 *
 * Before is how the screen renders now; after is a sibling screen that already
 * renders the value being moved to. Both are real captures rather than mockups,
 * which is why a token finding usually has only a before: a hardcoded colour
 * has no sibling screen that shows the fix, only a token that names it.
 *
 * Never throws. A pull request with the patch and no pictures is worth opening.
 */
async function uploadEvidence(
  input: OpenFixPullRequestInput & { screen: Screen; logger: ActuationLogger },
): Promise<EvidencePair> {
  const { finding, project, screen, logger } = input

  try {
    const siblingId = finding.evidence.siblingScreenIds[0] ?? null
    const sibling = siblingId ? await input.repositories.screens.get(siblingId) : null

    // Conforming changes this screen, so this screen is the before. Updating
    // the siblings changes them, so one of them is.
    const beforeScreen = input.direction === "conform" ? screen : sibling
    const afterScreen = input.direction === "conform" ? sibling : screen

    const beforePath = `${EVIDENCE_DIRECTORY}/${finding.id}/before.png`
    const afterPath = `${EVIDENCE_DIRECTORY}/${finding.id}/after.png`

    const files = []
    if (beforeScreen) {
      files.push({ path: beforePath, content: await downloadScreenshot(beforeScreen.screenshotPath) })
    }
    if (afterScreen) {
      files.push({ path: afterPath, content: await downloadScreenshot(afterScreen.screenshotPath) })
    }
    if (files.length === 0) return { before: null, after: null }

    await ensureBranch(input.octokit, {
      repo: project.repo,
      branch: EVIDENCE_BRANCH,
      fromRef: project.defaultBranch,
    })
    await commitFiles(input.octokit, {
      repo: project.repo,
      branch: EVIDENCE_BRANCH,
      message: `Evidence for finding ${finding.id}`,
      files,
    })

    logger.log("actuate.evidence_committed", {
      findingId: finding.id,
      branch: EVIDENCE_BRANCH,
      images: files.length,
    })

    return {
      before: beforeScreen
        ? {
            url: rawFileUrl(project.repo, EVIDENCE_BRANCH, beforePath),
            caption: caption(beforeScreen, "now"),
          }
        : null,
      after: afterScreen
        ? {
            url: rawFileUrl(project.repo, EVIDENCE_BRANCH, afterPath),
            caption: caption(afterScreen, "already"),
          }
        : null,
    }
  } catch (error) {
    logger.error("actuate.evidence_failed", {
      findingId: finding.id,
      message: actuationError(error),
    })
    return { before: null, after: null }
  }
}

function caption(screen: Screen, when: "now" | "already"): string {
  return when === "now"
    ? `${screen.route} at ${screen.viewport}, as it renders now.`
    : `${screen.route} at ${screen.viewport}, which already renders the value being moved to.`
}

function skip(branch: string, plan: PatchPlan, reason: string): PullRequestResult {
  return { opened: false, number: null, url: null, branch, plan, skipped: reason }
}

function emptyPlan(direction: PatchDirection, finding: Finding): PatchPlan {
  const { observedValue, expectedValue } = finding.evidence
  return {
    kind: "value",
    author: "mechanical",
    from: direction === "conform" ? observedValue : expectedValue,
    to: direction === "conform" ? expectedValue : observedValue,
    files: [],
    occurrences: 0,
    blocked: "The screen this finding cites is gone.",
  }
}
