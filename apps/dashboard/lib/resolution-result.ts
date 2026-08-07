/**
 * What the resolution routes answer with, as the browser reads it.
 *
 * Kept beside the handler rather than inferred in the component, so the shape
 * the server sends and the shape the page expects are one declaration. Every
 * field here is something a person needs told: where the patch went, why none
 * was opened, what moved about a convention, and what the score now reads.
 */

export interface ResolutionPullRequest {
  number: number
  url: string
  branch: string
  files: string[]
  occurrences: number
}

export interface ResolutionScore {
  score: number
  openFindings: number
  screensChecked: number
}

export interface ResolutionResponse {
  findingId: string
  action: string
  status: string
  resolutionId: string | null
  conventionChange: string | null
  driftScore: ResolutionScore | null
  pullRequest: ResolutionPullRequest | null
  /** Why no pull request was opened. Usually that the fix is not mechanical. */
  pullRequestSkipped: string | null
  pullRequestError: string | null
  rules: {
    path: string
    branch: string
    changed: boolean
    prNumber: number | null
  } | null
  rulesError: string | null
}

/** The error message a failed response carries, or null. */
export function responseError(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const error = (body as Record<string, unknown>).error
  return typeof error === "string" ? error : null
}
