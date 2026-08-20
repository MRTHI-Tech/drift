/**
 * The autonomous class, as a run reaches it.
 *
 * A run raises findings; a few of them are ones Drift may act on without being
 * asked. Which few is decided by `isAutonomousFix` and by nothing else here:
 * this module plans the patch that function needs to see, asks it, and does
 * what it says. Every answer is logged with its reason, so the log of a run is
 * a full account of what Drift could have done and why it did not.
 *
 * Nothing in here throws into the run. A repo that is not on the allowlist, a
 * token that has expired, a patch that cannot be planned: each costs a finding
 * its pull request and costs the run nothing. The findings are already written
 * and are already waiting for a person, which is where everything starts.
 */

import type { Octokit } from "@octokit/rest"

import { causeKeyOf } from "../dedupe"
import { fetchSourceFiles, isRepoAllowed, type SourceFile } from "../github"
import type { Repositories } from "../repositories"
import type { Finding, Project, Screen } from "../types"
import { isAutonomousFix } from "./autonomy"
import { actuationError, silentActuationLogger, type ActuationLogger } from "./logging"
import { openFixPullRequest } from "./open-pr"
import { planFindingPatch, type PatchPlan } from "./patch"

/** One finding a run raised, with what the diff knew when it raised it. */
export interface AutonomousCandidate {
  finding: Finding
  /**
   * Every other open finding with the same cause: the same value, missing the
   * same token, on a different screen. Empty when this sighting is the only
   * one.
   *
   * They are carried rather than dropped because they are all true and all
   * still open, and one fix closes all of them. What must not happen is a
   * pull request for the first one that leaves the other eleven sitting there
   * looking unaddressed.
   */
  siblingFindingIds: string[]
  /**
   * How far the observed value sits from the token it would be snapped to:
   * OKLab distance for a colour, pixels for a length. Only the run that
   * measured it knows this, which is why it travels with the finding.
   */
  nearestTokenDistance: number | null
}

/**
 * What the Fixer is asked, and what it answers. Declared here as an interface
 * rather than imported, so `@drift/core` does not depend on `@drift/agent`:
 * the flow in `packages/agent/src/flows/propose-fix.ts` satisfies it
 * structurally and the worker, which depends on both, is what joins them.
 *
 * A run with no proposer wired is a run that only ever opens mechanical
 * patches, which is exactly what every run did before section 10a admitted a
 * second class. Nothing about this port is required for a run to work.
 */
export interface FixRequest {
  finding: Finding
  files: readonly SourceFile[]
  /** Why the mechanical patcher would not do this. Never empty. */
  blocked: string
  route: string
  /**
   * What the element the finding cites actually says on the screen, out of
   * that screen's own extraction record. Empty when the element holds no text
   * or the screen is gone.
   *
   * This exists because a derived property's value is a reading rather than a
   * literal. A finding saying `cta.voice` should be `generic` gives the Fixer
   * nothing to search for: run against a real repo, it spent twenty turns
   * looking for the words "generic" and "specific" in the source, which were
   * never going to be there. What it needed was the label itself.
   */
  observedText: string
}

export interface FixProposal {
  /** Null when the Fixer found nothing it could safely do. */
  plan: PatchPlan | null
  /** Drops and declines, for the run log. */
  reasons: readonly string[]
}

export type FixProposer = (request: FixRequest) => Promise<FixProposal>

export interface AutonomousRunInput {
  octokit: Octokit
  project: Project
  candidates: readonly AutonomousCandidate[]
  repositories: Repositories
  logger?: ActuationLogger
  /** Decide everything, write nothing. */
  dryRun?: boolean
  /**
   * Asked only for a finding the mechanical patcher would not touch. Omitted,
   * and such a finding waits for a person exactly as it always has.
   */
  proposeFix?: FixProposer
}

export interface AutonomousRunResult {
  considered: number
  opened: { findingId: string; prNumber: number; url: string }[]
  /** Findings the boundary left for a person, each with the reason it gave. */
  waiting: { findingId: string; reason: string }[]
  /** Findings that qualified but whose pull request could not be opened. */
  failed: { findingId: string; message: string }[]
}

export async function openAutonomousPullRequests(
  input: AutonomousRunInput,
): Promise<AutonomousRunResult> {
  const logger = input.logger ?? silentActuationLogger
  const result: AutonomousRunResult = {
    considered: input.candidates.length,
    opened: [],
    waiting: [],
    failed: [],
  }

  if (input.candidates.length === 0) return result

  // The allowlist, asked before a single request leaves the process. A project
  // whose repo is not on it raises findings and opens nothing, quietly and
  // permanently, whatever Firestore says its repo is (AGENTS.md section 8).
  if (!isRepoAllowed(input.project.repo)) {
    logger.log("actuate.repo_not_allowed", {
      projectId: input.project.id,
      repo: input.project.repo,
      findings: input.candidates.length,
    })
    for (const candidate of input.candidates) {
      result.waiting.push({
        findingId: candidate.finding.id,
        reason: `${input.project.repo} is not on GITHUB_REPO_ALLOWLIST.`,
      })
    }
    return result
  }

  let files: SourceFile[]
  try {
    files = await fetchSourceFiles(input.octokit, {
      repo: input.project.repo,
      ref: input.project.defaultBranch,
    })
  } catch (error) {
    const message = actuationError(error)
    logger.error("actuate.source_unreadable", { repo: input.project.repo, message })
    for (const candidate of input.candidates) {
      result.waiting.push({ findingId: candidate.finding.id, reason: message })
    }
    return result
  }

  logger.log("actuate.start", {
    projectId: input.project.id,
    repo: input.project.repo,
    considered: result.considered,
    sourceFiles: files.length,
    dryRun: input.dryRun ?? false,
  })

  for (const candidate of input.candidates) {
    await consider(input, candidate, files, logger, result)
  }

  logger.log("actuate.finish", {
    considered: result.considered,
    opened: result.opened.length,
    waiting: result.waiting.length,
    failed: result.failed.length,
  })

  return result
}

async function consider(
  input: AutonomousRunInput,
  candidate: AutonomousCandidate,
  files: readonly SourceFile[],
  logger: ActuationLogger,
  result: AutonomousRunResult,
): Promise<void> {
  const { finding } = candidate

  const mechanical = planFindingPatch(finding, "conform", files)

  // The Fixer is never the first thing asked. It gets what a substitution
  // matched character for character could not put right, and it is told the
  // reason so it does not solve a problem that was already solved.
  const plan = mechanical.blocked !== null ? await askTheFixer(input, candidate, files, mechanical, logger) : mechanical

  const decision = isAutonomousFix({
    finding,
    plan,
    nearestTokenDistance: candidate.nearestTokenDistance,
  })

  // The auditable line. Every finding a run raised appears here exactly once,
  // whichever side of the boundary it fell on.
  logger.log("actuate.decision", {
    findingId: finding.id,
    type: finding.type,
    property: finding.evidence.property,
    observedValue: finding.evidence.observedValue,
    expectedSource: finding.evidence.expectedSource,
    autonomous: decision.autonomous,
    reason: decision.reason,
  })

  if (!decision.autonomous) {
    result.waiting.push({ findingId: finding.id, reason: decision.reason })
    return
  }

  try {
    const opened = await openFixPullRequest({
      octokit: input.octokit,
      project: input.project,
      finding,
      direction: "conform",
      opener: "run",
      repositories: input.repositories,
      sourceFiles: files,
      siblingFindingIds: candidate.siblingFindingIds,
      plan,
      logger,
      dryRun: input.dryRun,
    })

    if (opened.opened && opened.number !== null && opened.url !== null) {
      result.opened.push({ findingId: finding.id, prNumber: opened.number, url: opened.url })
    } else {
      result.waiting.push({
        findingId: finding.id,
        reason: opened.skipped ?? "Nothing was opened.",
      })
    }
  } catch (error) {
    const message = actuationError(error)
    result.failed.push({ findingId: finding.id, message })
    logger.error("actuate.failed", { findingId: finding.id, message })
  }
}

/**
 * The Fixer's plan for a finding the mechanical patcher blocked, or the
 * blocked plan back unchanged.
 *
 * Never throws and never lets a failure reach the run. A Fixer that is not
 * wired, that finds nothing, or that falls over leaves the finding exactly
 * where it already was: blocked, reported, and waiting for a person.
 */
async function askTheFixer(
  input: AutonomousRunInput,
  candidate: AutonomousCandidate,
  files: readonly SourceFile[],
  mechanical: PatchPlan,
  logger: ActuationLogger,
): Promise<PatchPlan> {
  if (!input.proposeFix) return mechanical

  const { finding } = candidate
  const screen = await input.repositories.screens.get(finding.screenId)

  try {
    const proposal = await input.proposeFix({
      finding,
      files,
      blocked: mechanical.blocked ?? "",
      route: screen?.route ?? "",
      observedText: observedTextOf(screen, finding.evidence.selector),
    })

    logger.log("actuate.fixer", {
      findingId: finding.id,
      blocked: mechanical.blocked,
      proposed: proposal.plan !== null,
      files: proposal.plan?.files.map((file) => file.path) ?? [],
      reasons: proposal.reasons,
    })

    return proposal.plan ?? mechanical
  } catch (error) {
    logger.error("actuate.fixer_failed", {
      findingId: finding.id,
      message: actuationError(error),
    })
    return mechanical
  }
}

/**
 * What the cited element says, as the extraction recorded it. Its own text
 * where it has some, and otherwise the text of everything under it, which is
 * how a button wrapping a span still reads as the thing it says.
 */
export function observedTextOf(screen: Screen | null, selector: string | null): string {
  if (!screen || !selector) return ""

  const own = screen.text[selector]
  if (own && own.length > 0) return own

  const prefix = `${selector} > `
  const parts: string[] = []
  for (const [key, value] of Object.entries(screen.text)) {
    if (key.startsWith(prefix) && value.length > 0) parts.push(value)
  }
  return parts.join(" ").replace(/\s+/g, " ").trim()
}

/**
 * The findings of a run that are worth asking the boundary about at all, one
 * per cause rather than one per sighting.
 *
 * Findings stay per screen, which is right: the drift really is on each of
 * them. What is asked and what is opened is per cause, because the same value
 * missing the same token on twelve screens is one mistake in one place, and
 * asking the Fixer about it twelve times would spend twelve model calls to
 * write the same line and open twelve pull requests carrying it.
 *
 * The representative is the oldest finding of its cause, and the tie breaks on
 * the id, so the same run always picks the same one and a pull request keeps
 * its branch across runs.
 */
export function actuationCandidates(
  findings: readonly Finding[],
  distances: ReadonlyMap<string, number>,
): AutonomousCandidate[] {
  const eligible = findings.filter(
    (finding) => finding.type === "token" && finding.evidence.expectedSource !== null,
  )

  const causes = new Map<string, Finding[]>()
  for (const finding of eligible) {
    const key = causeKeyOf(finding)
    const group = causes.get(key)
    if (group) group.push(finding)
    else causes.set(key, [finding])
  }

  const candidates: AutonomousCandidate[] = []
  for (const group of causes.values()) {
    const ordered = [...group].sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
    const [representative, ...siblings] = ordered

    candidates.push({
      finding: representative!,
      siblingFindingIds: siblings.map((finding) => finding.id),
      // The representative's own distance, since it is the one being fixed.
      nearestTokenDistance: distances.get(representative!.id) ?? null,
    })
  }

  return candidates
}
