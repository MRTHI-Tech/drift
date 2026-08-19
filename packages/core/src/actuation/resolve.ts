/**
 * Resolving one finding: the four things a person can say about it, and
 * everything each one sets in motion.
 *
 *   conform          the screen should change, so open the patch
 *   update siblings  the screen is right, so the convention moves to it
 *   exception        the screen is allowed to differ, permanently
 *   dismiss          nothing to do here
 *
 * The order of writes is deliberate. The decision is recorded first, because it
 * is the person's and it stands whether or not GitHub can be reached; the
 * actuation follows, and a failure in it is reported rather than allowed to
 * unmake the decision. A `resolutions` document is append-only and is never
 * deleted (AGENTS.md section 2), so resolving the same finding twice leaves two
 * entries and the second one wins on the finding.
 */

import type { Octokit } from "@octokit/rest"

import { fetchSourceFiles, githubClientFor, type SourceFile } from "../github"
import { createRepositories, type Repositories } from "../repositories"
import { refreshDriftScore, type DriftScoreRefresh } from "../score"
import type { Convention, Finding, FindingStatus, Project, Resolution } from "../types"
import { actuationError, silentActuationLogger, type ActuationLogger } from "./logging"
import { openFixPullRequest, type PullRequestResult } from "./open-pr"
import { planFindingPatch, type PatchDirection, type PatchPlan } from "./patch"
import { syncRulesFile, type RulesSyncResult } from "./rules-sync"
import type { FixProposer } from "./run-actuation"

/** What a person can say about a finding. */
export type ResolutionAction = "conform" | "update_siblings" | "exception" | "dismiss"

export const RESOLUTION_ACTIONS: readonly ResolutionAction[] = [
  "conform",
  "update_siblings",
  "exception",
  "dismiss",
]

/** The status each action moves the finding to. */
export const STATUS_OF_ACTION: Record<ResolutionAction, FindingStatus> = {
  conform: "resolved_conform",
  update_siblings: "resolved_update_siblings",
  exception: "resolved_exception",
  dismiss: "dismissed",
}

/** Which way a patch runs for each action, or null where none is implied. */
const DIRECTION_OF_ACTION: Record<ResolutionAction, PatchDirection | null> = {
  conform: "conform",
  update_siblings: "siblings",
  exception: null,
  dismiss: null,
}

/** Raised when a resolution cannot be applied at all. Nothing is written. */
export class ResolutionError extends Error {
  // Typed as string rather than as the literal so a subclass can name itself.
  override readonly name: string = "ResolutionError"
}

/**
 * Raised when the finding, its project, or its convention is not there. Its own
 * class so a caller can tell a request naming something that does not exist
 * from a request asking for something that cannot be done.
 */
export class ResolutionNotFoundError extends ResolutionError {
  override readonly name = "ResolutionNotFoundError"
}

export interface ResolveFindingInput {
  findingId: string
  action: ResolutionAction
  /** Why the screen is allowed to differ. Required by `exception`. */
  reason?: string
  repositories?: Repositories
  /** Injectable for tests. Defaults to the client built from `GITHUB_TOKEN`. */
  octokit?: Octokit
  logger?: ActuationLogger
  /** Work everything out, write nothing to Firestore or to GitHub. */
  dryRun?: boolean
  /**
   * Asked when a person chose a direction and the mechanical patcher cannot
   * plan it. This is the path pattern drift reaches the Fixer by, and the
   * distinction from the unprompted path is the whole reason it is allowed to:
   * whether the screen or its siblings should change is a judgment about the
   * product, and here a person has already made it. What is left is finding
   * where the value is written, which is work rather than judgment.
   *
   * Omitted, and a finding no substitution can reach is reported exactly as it
   * always has been.
   */
  proposeFix?: FixProposer
}

export interface ResolveFindingResult {
  finding: Finding
  action: ResolutionAction
  status: FindingStatus
  /** The `resolutions` document written, or null on a dry run. */
  resolution: Resolution | null
  /** What changed about a convention, in one line. Null when none did. */
  conventionChange: string | null
  pullRequest: PullRequestResult | null
  /** Why no pull request was opened, when the attempt itself failed. */
  pullRequestError: string | null
  rules: RulesSyncResult | null
  rulesError: string | null
  /** The project's drift score after this decision. Null on a dry run. */
  driftScore: DriftScoreRefresh | null
}

export async function resolveFinding(
  input: ResolveFindingInput,
): Promise<ResolveFindingResult> {
  const repositories = input.repositories ?? createRepositories()
  const logger = input.logger ?? silentActuationLogger
  const dryRun = input.dryRun ?? false

  const finding = await repositories.findings.get(input.findingId)
  if (!finding) {
    throw new ResolutionNotFoundError(`There is no finding ${input.findingId}. Nothing was written.`)
  }

  const project = await repositories.projects.get(finding.projectId)
  if (!project) {
    throw new ResolutionNotFoundError(
      `Finding ${finding.id} belongs to project ${finding.projectId}, which is gone.`,
    )
  }

  const reason = input.reason?.trim() ?? ""
  assertApplicable(finding, input.action, reason)

  const status = STATUS_OF_ACTION[input.action]
  logger.log("resolve.start", {
    findingId: finding.id,
    projectId: project.id,
    action: input.action,
    type: finding.type,
    property: finding.evidence.property,
    dryRun,
  })

  const change = await applyConventionChange({
    finding,
    action: input.action,
    reason,
    repositories,
    logger,
    dryRun,
  })

  const resolution = dryRun
    ? null
    : await repositories.resolutions.create({
        projectId: project.id,
        findingId: finding.id,
        action: status,
        resultingConventionChange: change.summary,
        createdAt: new Date(),
      })

  const resolved = dryRun ? finding : await repositories.findings.setStatus(finding.id, status)

  logger.log("resolve.recorded", {
    findingId: finding.id,
    action: input.action,
    status,
    resolutionId: resolution?.id ?? null,
    conventionChange: change.summary,
  })

  // The score is a count of what is still open, so it moves here, with the
  // status, rather than after the pull request. GitHub being unreachable does
  // not make the finding open again.
  const driftScore = dryRun ? null : await rescore(project, repositories, logger)

  const outcome = await actuate({
    ...input,
    project,
    finding: resolved,
    repositories,
    logger,
    dryRun,
    conventionChanged: change.changed,
  })

  const latest = dryRun ? resolved : ((await repositories.findings.get(finding.id)) ?? resolved)

  logger.log("resolve.finish", {
    findingId: finding.id,
    status,
    prNumber: latest.prNumber,
    rulesChanged: outcome.rules?.changed ?? null,
    driftScore: driftScore?.score ?? null,
  })

  return {
    finding: latest,
    action: input.action,
    status,
    resolution,
    conventionChange: change.summary,
    driftScore,
    ...outcome,
  }
}

/**
 * Recomputes the project's drift score. Caught rather than thrown: the decision
 * is already recorded, and a score that is one resolution stale is a wrong
 * number on a nav footer, not a reason to fail the resolution.
 */
async function rescore(
  project: Project,
  repositories: Repositories,
  logger: ActuationLogger,
): Promise<DriftScoreRefresh | null> {
  try {
    const refreshed = await refreshDriftScore(project.id, repositories)
    logger.log("resolve.rescored", {
      projectId: project.id,
      from: project.driftScore,
      to: refreshed.score,
      openFindings: refreshed.openFindings,
      screensChecked: refreshed.screensChecked,
    })
    return refreshed
  } catch (error) {
    logger.error("resolve.rescore_failed", {
      projectId: project.id,
      message: actuationError(error),
    })
    return null
  }
}

/**
 * The reasons an action cannot be applied to a finding at all. Each one is a
 * question the action does not answer rather than a rule that could be relaxed.
 */
function assertApplicable(finding: Finding, action: ResolutionAction, reason: string): void {
  if (action === "exception" && reason.length === 0) {
    throw new ResolutionError(
      "An exception needs a reason. It is respected permanently, so the next " +
        "person to read it has to know why it is there.",
    )
  }

  if (action === "update_siblings" && finding.type === "token") {
    throw new ResolutionError(
      "A token finding has no siblings to update. The value it missed is declared " +
        "in the token file, and changing that file is a decision about the design " +
        "system rather than a mechanical patch. Accept it as an exception instead.",
    )
  }

  if (action === "update_siblings" && !finding.conventionId) {
    throw new ResolutionError(
      `Finding ${finding.id} answers to no convention, so there is nothing to move.`,
    )
  }
}

interface ConventionChangeInput {
  finding: Finding
  action: ResolutionAction
  reason: string
  repositories: Repositories
  logger: ActuationLogger
  dryRun: boolean
}

interface ConventionChange {
  changed: boolean
  /** The line stored on the resolution, or null when nothing changed. */
  summary: string | null
}

/**
 * What each action does to the convention behind the finding.
 *
 * Conforming leaves it alone: the convention was right and the screen is being
 * brought to it. Updating the siblings moves it, and promotes it, because a
 * value a person chose is not a value that was counted. An exception is added
 * to it and never removed (AGENTS.md section 6).
 */
async function applyConventionChange(input: ConventionChangeInput): Promise<ConventionChange> {
  const { finding, action } = input
  if (action === "conform" || action === "dismiss") return { changed: false, summary: null }

  const conventionId = finding.conventionId
  if (!conventionId) {
    // A token finding accepted as an exception has no convention to record it
    // on. The decision still stands: findings are never deleted and the dedupe
    // key means this value on this route is never raised again.
    return action === "exception"
      ? {
          changed: false,
          summary: `Allowed on this screen. Reason: ${input.reason}`,
        }
      : { changed: false, summary: null }
  }

  const convention = await input.repositories.conventions.get(conventionId)
  if (!convention) {
    throw new ResolutionNotFoundError(
      `Finding ${finding.id} answers to convention ${conventionId}, which is gone.`,
    )
  }

  return action === "update_siblings"
    ? moveConvention(input, convention)
    : recordException(input, convention)
}

/**
 * The screen was right, so the convention moves to it. Its evidence becomes
 * that one screen and its status becomes promoted: the three-screen floor in
 * AGENTS.md section 2 is what a convention needs to be *derived* from counting,
 * and this one was not counted, it was chosen. Every sibling still rendering
 * the old value diverges from it now, which is the point.
 */
async function moveConvention(
  input: ConventionChangeInput,
  convention: Convention,
): Promise<ConventionChange> {
  const { finding } = input
  const value = finding.evidence.observedValue

  const summary =
    `${convention.property} moved from ${convention.value} to ${value} ` +
    `and is now promoted, on the evidence of ${finding.screenId}.`

  if (!input.dryRun) {
    await input.repositories.conventions.update(convention.id, {
      value,
      label: `${convention.property} is ${value}`,
      confidence: "high",
      status: "promoted",
      evidenceScreenIds: [finding.screenId],
      updatedAt: new Date(),
    })
  }

  input.logger.log("resolve.convention_moved", {
    conventionId: convention.id,
    property: convention.property,
    from: convention.value,
    to: value,
  })

  return { changed: true, summary }
}

/** The screen is allowed to differ, for a stated reason, permanently. */
async function recordException(
  input: ConventionChangeInput,
  convention: Convention,
): Promise<ConventionChange> {
  const { finding, reason } = input

  const already = convention.exceptions.some(
    (exception) => exception.screenId === finding.screenId,
  )
  const summary = `${finding.screenId} recorded as an exception to ${convention.property}. Reason: ${reason}`

  if (already) {
    return { changed: false, summary: `${summary} It was already recorded.` }
  }

  if (!input.dryRun) {
    await input.repositories.conventions.update(convention.id, {
      exceptions: [...convention.exceptions, { screenId: finding.screenId, reason }],
      updatedAt: new Date(),
    })
  }

  input.logger.log("resolve.exception_recorded", {
    conventionId: convention.id,
    property: convention.property,
    screenId: finding.screenId,
  })

  return { changed: true, summary }
}

interface ActuateInput extends ResolveFindingInput {
  project: Project
  finding: Finding
  repositories: Repositories
  logger: ActuationLogger
  dryRun: boolean
  conventionChanged: boolean
  proposeFix?: FixProposer
}

interface ActuateResult {
  pullRequest: PullRequestResult | null
  pullRequestError: string | null
  rules: RulesSyncResult | null
  rulesError: string | null
}

/**
 * The Fixer's plan for a resolution the mechanical patcher cannot carry out,
 * along with the files both were planned against.
 *
 * Null when there is no proposer wired, when the repo cannot be read, or when
 * the mechanical patcher can do the job on its own. In every one of those
 * cases `openFixPullRequest` goes on to fetch and plan exactly as it did
 * before, so the path a person takes through a resolution is unchanged by
 * whether a Fixer exists.
 *
 * Never throws. A Fixer that falls over costs the resolution nothing: the
 * decision is already recorded, and the pull request falls back to the
 * mechanical attempt and its own blocked reason.
 */
async function plannedFix(
  input: ActuateInput,
  octokit: Octokit,
  direction: PatchDirection,
): Promise<{ files: SourceFile[]; plan: PatchPlan } | null> {
  if (!input.proposeFix) return null

  try {
    const files = await fetchSourceFiles(octokit, {
      repo: input.project.repo,
      ref: input.project.defaultBranch,
    })

    const mechanical = planFindingPatch(input.finding, direction, files)
    if (mechanical.blocked === null) return { files, plan: mechanical }

    const screen = await input.repositories.screens.get(input.finding.screenId)
    const proposal = await input.proposeFix({
      finding: input.finding,
      files,
      blocked: mechanical.blocked,
      route: screen?.route ?? "",
    })

    input.logger.log("resolve.fixer", {
      findingId: input.finding.id,
      blocked: mechanical.blocked,
      proposed: proposal.plan !== null,
      files: proposal.plan?.files.map((file) => file.path) ?? [],
      reasons: proposal.reasons,
    })

    return { files, plan: proposal.plan ?? mechanical }
  } catch (error) {
    input.logger.error("resolve.fixer_failed", {
      findingId: input.finding.id,
      message: actuationError(error),
    })
    return null
  }
}

/**
 * The GitHub side of a resolution. Both halves are caught rather than thrown:
 * the decision is already recorded, and a repo that is not on the allowlist, a
 * token that has expired, or a rate limit is something to report, not something
 * that should make a person resolve the finding twice.
 */
async function actuate(input: ActuateInput): Promise<ActuateResult> {
  const result: ActuateResult = {
    pullRequest: null,
    pullRequestError: null,
    rules: null,
    rulesError: null,
  }

  const direction = DIRECTION_OF_ACTION[input.action]
  const needsGitHub = direction !== null || input.conventionChanged
  if (!needsGitHub) return result

  let octokit: Octokit
  try {
    octokit = input.octokit ?? githubClientFor(input.project.installationId)
  } catch (error) {
    const message = actuationError(error)
    input.logger.error("resolve.github_unavailable", { message })
    return { ...result, pullRequestError: message, rulesError: message }
  }

  if (direction) {
    try {
      const fixed = await plannedFix(input, octokit, direction)

      result.pullRequest = await openFixPullRequest({
        octokit,
        project: input.project,
        finding: input.finding,
        direction,
        opener: "resolution",
        repositories: input.repositories,
        sourceFiles: fixed?.files,
        plan: fixed?.plan,
        logger: input.logger,
        dryRun: input.dryRun,
      })
    } catch (error) {
      result.pullRequestError = actuationError(error)
      input.logger.error("resolve.pull_request_failed", {
        findingId: input.finding.id,
        message: result.pullRequestError,
      })
    }
  }

  // The rules file states the conventions, so it is regenerated exactly when
  // one of them moved (AGENTS.md: on any convention change).
  if (input.conventionChanged) {
    try {
      result.rules = await syncRulesFile({
        octokit,
        project: input.project,
        repositories: input.repositories,
        logger: input.logger,
        dryRun: input.dryRun,
      })
    } catch (error) {
      result.rulesError = actuationError(error)
      input.logger.error("resolve.rules_failed", {
        projectId: input.project.id,
        message: result.rulesError,
      })
    }
  }

  return result
}
