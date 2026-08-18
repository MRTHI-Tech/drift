/**
 * The shared body of the four resolution route handlers.
 *
 * Each route is one verb on one finding and nothing else. All four call the
 * same `resolveFinding` in `@drift/core`, which is also what the worker's
 * temporary `resolve` command calls, so a finding resolved from a terminal and
 * a finding resolved from the dashboard go through exactly one path: one
 * `resolutions` document, one status change, one convention update where the
 * action implies one, one pull request where the action implies one.
 *
 * Every one of these routes requires a session (AGENTS.md section 1). They
 * write to Firestore and open pull requests against somebody's repository, so
 * the check is the first thing each handler does, before the body is read. The
 * `GITHUB_REPO_ALLOWLIST` gate holds underneath it regardless: nothing here can
 * open a pull request against a repo that is not on it.
 */

import {
  ResolutionError,
  ResolutionNotFoundError,
  resolveFinding,
  type ResolutionAction,
  type ResolveFindingResult,
} from "@drift/core"

import { apiOwner, notYours, ownedVia } from "@/lib/ownership"

/** The dynamic segment every resolution route carries. */
export interface FindingParams {
  params: Promise<{ findingId: string }>
}

/** What a caller may send. Both fields are optional; `reason` is not for an exception. */
interface ResolutionBody {
  reason?: string
  dryRun?: boolean
}

/**
 * Runs one resolution and answers with what it did. Every failure answers with
 * a message a person can act on rather than a stack: a finding that is not
 * there is a 404, an action that does not apply to this finding is a 400, and
 * anything else is a 500.
 */
export async function handleResolution(
  request: Request,
  context: FindingParams,
  action: ResolutionAction
): Promise<Response> {
  const gate = await apiOwner()
  if (gate.response) return gate.response

  const { findingId } = await context.params
  const body = await readBody(request)

  // Before anything is resolved, and before a pull request could be opened
  // against somebody's repository: is this finding on a project this person
  // made. A finding that is not there and a finding that is not theirs answer
  // the same way.
  const finding = await gate.repositories.findings.get(findingId)
  if (!(await ownedVia(finding, gate.userId, gate.repositories))) {
    return notYours()
  }

  try {
    const result = await resolveFinding({
      findingId,
      action,
      reason: body.reason,
      dryRun: body.dryRun,
    })
    return Response.json(present(result))
  } catch (error) {
    if (error instanceof ResolutionNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof ResolutionError) {
      return Response.json({ error: error.message }, { status: 400 })
    }
    return Response.json({ error: message(error) }, { status: 500 })
  }
}

/**
 * A resolution as JSON. Deliberately not the whole finding: what a caller needs
 * back is what changed, where the pull request went, and what did not happen.
 */
function present(result: ResolveFindingResult) {
  return {
    findingId: result.finding.id,
    action: result.action,
    status: result.status,
    resolutionId: result.resolution?.id ?? null,
    conventionChange: result.conventionChange,
    // What the nav footer should now read. Sent back so the page that made the
    // decision can say what it moved, rather than only re-rendering the number.
    driftScore: result.driftScore
      ? {
          score: result.driftScore.score,
          openFindings: result.driftScore.openFindings,
          screensChecked: result.driftScore.screensChecked,
        }
      : null,
    pullRequest: result.pullRequest?.opened
      ? {
          number: result.pullRequest.number,
          url: result.pullRequest.url,
          branch: result.pullRequest.branch,
          files: result.pullRequest.plan.files.map((file) => file.path),
          occurrences: result.pullRequest.plan.occurrences,
        }
      : null,
    // Why no pull request was opened. A patch that could not be planned
    // mechanically is the ordinary case, not an error.
    pullRequestSkipped: result.pullRequest?.skipped ?? null,
    pullRequestError: result.pullRequestError,
    rules: result.rules
      ? {
          path: result.rules.path,
          branch: result.rules.branch,
          changed: result.rules.changed,
          prNumber: result.rules.prNumber,
        }
      : null,
    rulesError: result.rulesError,
  }
}

/** The request body, or an empty one. A body is optional on three of the four. */
async function readBody(request: Request): Promise<ResolutionBody> {
  try {
    const value: unknown = await request.json()
    if (typeof value !== "object" || value === null) return {}

    const record = value as Record<string, unknown>
    return {
      reason: typeof record.reason === "string" ? record.reason : undefined,
      dryRun: record.dryRun === true,
    }
  } catch {
    return {}
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
