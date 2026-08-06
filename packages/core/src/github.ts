/**
 * Every GitHub call Drift makes lives here (AGENTS.md section 1). Fine-grained
 * PAT from `GITHUB_TOKEN` for now, GitHub App later; callers never build their
 * own client and never touch the REST API directly.
 */
import { Octokit } from "@octokit/rest"

import { parseDriftConfig, DriftConfigError, type DriftConfig } from "./config"
import type { Project } from "./types"

/** Raised when GitHub cannot be reached or answers with something unusable. */
export class GitHubError extends Error {
  override readonly name = "GitHubError"
}

/** An `owner/name` repo, split. */
export interface RepoRef {
  owner: string
  repo: string
}

/** Splits a stored `owner/name` string. Throws on anything else. */
export function parseRepo(repo: string): RepoRef {
  const parts = repo.split("/")
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new GitHubError(`A repo must be owner/name. Got ${repo}.`)
  }
  return { owner: parts[0], repo: parts[1] }
}

/**
 * The authenticated client. The token is read from the environment so it is
 * never passed around, never stored, and never logged (AGENTS.md section 1).
 */
export function createGitHubClient(token: string | undefined = process.env.GITHUB_TOKEN): Octokit {
  if (!token) {
    throw new GitHubError("GITHUB_TOKEN is not set. See AGENTS.md section 8.")
  }
  return new Octokit({ auth: token, userAgent: "drift-worker" })
}

export interface FetchFileInput {
  /** `owner/name`. */
  repo: string
  /** Repo-relative path. */
  path: string
  /** Branch, tag, or sha. */
  ref: string
}

/**
 * Reads one UTF-8 file out of a repo at a ref. Returns null when the file does
 * not exist, so a missing file reads differently from a broken request.
 */
export async function fetchRepoFile(
  octokit: Octokit,
  { repo, path, ref }: FetchFileInput,
): Promise<string | null> {
  const target = parseRepo(repo)

  let data
  try {
    const response = await octokit.rest.repos.getContent({ ...target, path, ref })
    data = response.data
  } catch (cause) {
    if (isNotFound(cause)) return null
    throw new GitHubError(`Could not read ${repo}/${path} at ${ref}. ${describe(cause)}`, { cause })
  }

  if (Array.isArray(data)) {
    throw new GitHubError(`${repo}/${path} at ${ref} is a directory, not a file.`)
  }
  if (data.type !== "file") {
    throw new GitHubError(`${repo}/${path} at ${ref} is a ${data.type}, not a file.`)
  }
  if (data.encoding !== "base64") {
    // Files over 1 MB come back with an empty body and encoding "none".
    throw new GitHubError(`${repo}/${path} at ${ref} is too large to read inline.`)
  }

  return Buffer.from(data.content, "base64").toString("utf8")
}

/** The parts of a project a config fetch needs. */
export type ConfigSource = Pick<Project, "repo" | "configPath" | "defaultBranch">

/**
 * Reads and validates a watched project's `drift.config.json` from its default
 * branch. The config is the only declaration of what Drift renders; Drift never
 * crawls (AGENTS.md section 9).
 */
export async function fetchDriftConfig(
  octokit: Octokit,
  { repo, configPath, defaultBranch }: ConfigSource,
): Promise<DriftConfig> {
  const text = await fetchRepoFile(octokit, { repo, path: configPath, ref: defaultBranch })
  if (text === null) {
    throw new GitHubError(`${repo} has no ${configPath} on ${defaultBranch}.`)
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw new DriftConfigError(`${repo}/${configPath} on ${defaultBranch} is not valid JSON`, {
      cause,
    })
  }

  try {
    return parseDriftConfig(value)
  } catch (cause) {
    if (cause instanceof DriftConfigError) {
      throw new DriftConfigError(
        `${repo}/${configPath} on ${defaultBranch} is not valid. ${cause.message}`,
        { cause },
      )
    }
    throw cause
  }
}

function isNotFound(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "status" in cause && cause.status === 404
}

/** Error text safe to log: GitHub's message, never the request headers. */
function describe(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "status" in cause) {
    return `GitHub answered ${String(cause.status)}.`
  }
  return cause instanceof Error ? cause.message : String(cause)
}
