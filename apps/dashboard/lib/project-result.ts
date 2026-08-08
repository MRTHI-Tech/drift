/**
 * What the three project routes answer with, as the browser reads them.
 *
 * Declared here rather than imported from `@drift/core` because the dialog is a
 * client component: `@drift/core` pulls in firebase-admin and Octokit, and
 * neither belongs in a browser bundle. These are the shapes that cross the wire,
 * and the route handlers are what keep them true.
 */

/** Matches `CheckStatus` in `@drift/core`. `warn` does not block a save. */
export type CheckStatus = "pass" | "warn" | "fail" | "skipped"

export interface PreflightCheck {
  id: string
  status: CheckStatus
  message: string
  remedy: string | null
}

export interface Inspection {
  checks: PreflightCheck[]
  /** True when nothing failed. Warnings do not stop a project being created. */
  ok: boolean
  repo: { repo: string; defaultBranch: string; private: boolean; writable: boolean } | null
  configMissing: boolean
  advisories: {
    allowlisted: boolean
    authCookie: { name: string; valueSet: boolean } | null
  }
  /** The repo as it will be stored, so the dialog and the create call agree. */
  repoSlug: string
  /** The config Drift would write, when the repo has none. */
  proposal: { content: string; path: string; tokenDefinitionsPath: string | null } | null
  /** Whether Drift may open that proposal, which needs the allowlist. */
  canProposeConfig: boolean
}

export interface CreatedProject {
  projectId: string
  name: string
  repo: string
  firstRun: {
    started: boolean
    executionId: string | null
    command: string | null
    reason: string | null
  }
  configPullRequest: { number: number; url: string } | null
  configPullRequestError: string | null
}

export interface ProposedConfig {
  number: number
  url: string
  branch: string
  path: string
}

/** The error message a failed response carries, or null. */
export function responseMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const error = (body as Record<string, unknown>).error
  return typeof error === "string" ? error : null
}

/** Which field a failed response blames, when it blames one. */
export function fieldError(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const field = (body as Record<string, unknown>).field
  return typeof field === "string" ? field : null
}
