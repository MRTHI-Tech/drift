/**
 * The `resolve` command: one finding, one decision, from a terminal.
 *
 * Temporary. The dashboard owns resolutions once it has a findings page, and
 * the route handlers in `apps/dashboard/app/api` already call the same
 * `resolveFinding` this does. This exists so the phase is testable before there
 * is anything to click.
 */

import {
  RESOLUTION_ACTIONS,
  resolveFinding,
  type ResolutionAction,
  type ResolveFindingResult,
} from "@drift/core"

import type { Logger } from "./logger"

/**
 * The action names a person types, derived from the canonical list rather than
 * written out again, so a fifth action would get its flag for free.
 */
export const ACTION_FLAGS: Record<string, ResolutionAction> = Object.fromEntries(
  RESOLUTION_ACTIONS.map((action) => [action.replace(/_/g, "-"), action]),
)

/** Every flag spelling, for the usage text and for error messages. */
export const ACTIONS_LINE = Object.keys(ACTION_FLAGS).join(" | ")

/** Reads an action off the command line. Null for anything else. */
export function parseAction(value: string | undefined): ResolutionAction | null {
  if (!value) return null
  return ACTION_FLAGS[value.trim().toLowerCase()] ?? null
}

export interface ResolveCommandInput {
  findingId: string
  action: ResolutionAction
  reason?: string
  dryRun?: boolean
  logger: Logger
}

/**
 * Runs one resolution and reports it. Returns the exit code: a resolution whose
 * pull request or rules file could not be written is a failed command even
 * though the decision itself was recorded, because a person watching a terminal
 * should not have to read the log to notice.
 */
export async function resolveCommand(input: ResolveCommandInput): Promise<number> {
  const logger = input.logger.child({ findingId: input.findingId })

  const result = await resolveFinding({
    findingId: input.findingId,
    action: input.action,
    reason: input.reason,
    dryRun: input.dryRun,
    logger,
  })

  report(result)
  return result.pullRequestError || result.rulesError ? 1 : 0
}

/**
 * What happened, in plain lines on stdout rather than as a log object. The
 * structured lines are already in the log; this is the part a person reads.
 */
function report(result: ResolveFindingResult): void {
  const lines: string[] = [
    `Finding ${result.finding.id} is now ${result.status}.`,
  ]

  if (result.conventionChange) lines.push(result.conventionChange)

  if (result.pullRequest?.opened) {
    lines.push(
      `Pull request ${result.pullRequest.number}: ${result.pullRequest.url ?? ""}`.trim(),
      `Branch ${result.pullRequest.branch}, ` +
        `${result.pullRequest.plan.occurrences} occurrence(s) in ` +
        `${result.pullRequest.plan.files.map((file) => file.path).join(", ")}.`,
    )
  } else if (result.pullRequest?.skipped) {
    lines.push(`No pull request. ${result.pullRequest.skipped}`)
  }

  if (result.pullRequestError) lines.push(`The pull request failed. ${result.pullRequestError}`)

  if (result.rules) {
    lines.push(
      result.rules.skipped
        ? `Rules file not written. ${result.rules.skipped}`
        : `${result.rules.path} on ${result.rules.branch}: ` +
            `${result.rules.changed ? "updated" : "unchanged"}` +
            `${result.rules.prNumber ? `, proposed as pull request ${result.rules.prNumber}` : ""}.`,
    )
  }

  if (result.rulesError) lines.push(`The rules file failed. ${result.rulesError}`)

  console.log(lines.join("\n"))
}
