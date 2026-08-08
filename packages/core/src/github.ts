/**
 * Every GitHub call Drift makes lives here (AGENTS.md section 1). Fine-grained
 * PAT from `GITHUB_TOKEN` for now, GitHub App later; callers never build their
 * own client and never touch the REST API directly.
 */
import { Octokit } from "@octokit/rest"

import { parseTokenDefinitions, type TokenSet } from "./analysis/tokens"
import { parseDriftConfig, DriftConfigError, type DriftConfig } from "./config"
import type { Project } from "./types"

/** Raised when GitHub cannot be reached or answers with something unusable. */
export class GitHubError extends Error {
  // Typed as string rather than as the literal so a subclass can name itself.
  override readonly name: string = "GitHubError"
}

/**
 * Raised when a write is attempted against a repo that is not on
 * `GITHUB_REPO_ALLOWLIST`. Its own class because it is not a transport
 * failure and must never be retried, swallowed, or worked around.
 */
export class RepoNotAllowedError extends GitHubError {
  override readonly name = "RepoNotAllowedError"
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
 * The repos Drift may write to, from `GITHUB_REPO_ALLOWLIST`
 * (AGENTS.md section 8). Empty when the variable is unset, which means no repo
 * is writable rather than every repo is.
 */
export function repoAllowlist(raw = process.env.GITHUB_REPO_ALLOWLIST): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/** Whether a repo is on the allowlist. Owner and name compare case-insensitively. */
export function isRepoAllowed(repo: string, allowlist: readonly string[] = repoAllowlist()): boolean {
  const wanted = repo.trim().toLowerCase()
  return allowlist.some((entry) => entry.toLowerCase() === wanted)
}

/**
 * The hard gate of AGENTS.md section 8, and the only thing standing between
 * Drift and a stranger's repository. Every function in this module that writes
 * calls this first, before it touches the network, regardless of what Firestore
 * says the project's repo is. There is no flag that turns it off.
 */
export function assertRepoAllowed(
  repo: string,
  allowlist: readonly string[] = repoAllowlist(),
): void {
  if (isRepoAllowed(repo, allowlist)) return

  const known = allowlist.length > 0 ? allowlist.join(", ") : "nothing"
  throw new RepoNotAllowedError(
    `${repo} is not on GITHUB_REPO_ALLOWLIST, which allows ${known}. ` +
      "Drift opens no pull request against a repo that is not on it. " +
      "See AGENTS.md section 8.",
  )
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

/** What Drift knows about a repo before it has read anything out of it. */
export interface RepoMetadata {
  /** `owner/name` as GitHub spells it, which may differ in case from the input. */
  repo: string
  defaultBranch: string
  private: boolean
  /** True when the token can push. A read-only token watches but never proposes. */
  writable: boolean
}

/**
 * Reads a repo's own metadata. Its purpose is to answer, before a project is
 * created, whether this token can see this repo at all, and to take the default
 * branch from GitHub rather than from somebody typing `master`.
 *
 * Returns null when GitHub answers 404, which for a private repo the token
 * cannot see is the same answer as for a repo that does not exist. That
 * ambiguity is GitHub's and cannot be resolved from here, so the caller states
 * both possibilities rather than guessing one.
 */
export async function fetchRepoMetadata(
  octokit: Octokit,
  repo: string,
): Promise<RepoMetadata | null> {
  const target = parseRepo(repo)

  try {
    const response = await octokit.rest.repos.get({ ...target })
    return {
      repo: response.data.full_name,
      defaultBranch: response.data.default_branch,
      private: response.data.private,
      writable: response.data.permissions?.push ?? false,
    }
  } catch (cause) {
    if (isNotFound(cause)) return null
    throw new GitHubError(`Could not read ${repo}. ${describe(cause)}`, { cause })
  }
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

/** A watched repo's token file, read and parsed. */
export interface TokenDefinitions {
  /** Repo-relative path the tokens were read from. */
  path: string
  tokens: TokenSet
}

/**
 * Reads the file a project's config points `tokenDefinitionsPath` at. Returns
 * null when the config declares no path, or when the path is not there any
 * more: a stale path costs the run its token findings, not its screens.
 */
export async function fetchTokenDefinitions(
  octokit: Octokit,
  { repo, defaultBranch }: Omit<ConfigSource, "configPath">,
  path: string | null,
): Promise<TokenDefinitions | null> {
  if (!path) return null

  const text = await fetchRepoFile(octokit, { repo, path, ref: defaultBranch })
  if (text === null) return null

  return { path, tokens: parseTokenDefinitions(text, path) }
}

/** One source file of a watched repo, as a patch is planned against it. */
export interface SourceFile {
  /** Repo-relative path. */
  path: string
  text: string
}

/**
 * Extensions a mechanical patch can be planned against: the files a label or a
 * hardcoded value is actually written in. Everything else in a repo is read by
 * nothing here.
 */
export const SOURCE_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".vue",
  ".svelte",
  ".astro",
  ".html",
  ".mdx",
  ".css",
  ".scss",
  ".sass",
  ".less",
]

/** Directories never read: build output, dependencies, and Drift's own folder. */
export const IGNORED_DIRECTORIES: readonly string[] = [
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "dist",
  "build",
  "out",
  "coverage",
  "storybook-static",
  ".drift",
]

/** Most source files read for one patch. A repo past this is not hand-authored. */
export const MAX_SOURCE_FILES = 400

/** Largest file read. A generated bundle is not where a label lives. */
export const MAX_SOURCE_FILE_BYTES = 256 * 1024

/** Whether a repo path is source a patch could be planned against. */
export function isSourcePath(path: string): boolean {
  const segments = path.split("/")
  if (segments.some((segment) => IGNORED_DIRECTORIES.includes(segment))) return false

  const name = segments[segments.length - 1] ?? ""
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return false

  return SOURCE_EXTENSIONS.includes(name.slice(dot).toLowerCase())
}

export interface SourceTreeInput {
  /** `owner/name`. */
  repo: string
  /** Branch, tag, or sha. */
  ref: string
  limit?: number
}

/**
 * Every source file of a repo at a ref, read as text.
 *
 * The whole tree comes back in one request and the blobs are then read one at a
 * time, which is slower than a code search but exact: a patch is planned by
 * matching a literal character for character, and a search index that is stale
 * or fuzzy would plan a patch against a file that no longer says what it says.
 */
export async function fetchSourceFiles(
  octokit: Octokit,
  { repo, ref, limit = MAX_SOURCE_FILES }: SourceTreeInput,
): Promise<SourceFile[]> {
  const target = parseRepo(repo)

  let tree
  try {
    const response = await octokit.rest.git.getTree({
      ...target,
      tree_sha: ref,
      recursive: "true",
    })
    tree = response.data
  } catch (cause) {
    throw new GitHubError(`Could not read the tree of ${repo} at ${ref}. ${describe(cause)}`, {
      cause,
    })
  }

  const wanted = tree.tree
    .filter(
      (entry): entry is typeof entry & { path: string; sha: string } =>
        entry.type === "blob" &&
        typeof entry.path === "string" &&
        typeof entry.sha === "string" &&
        isSourcePath(entry.path) &&
        (entry.size ?? 0) <= MAX_SOURCE_FILE_BYTES,
    )
    .slice(0, limit)

  const files: SourceFile[] = []
  for (const entry of wanted) {
    const blob = await octokit.rest.git.getBlob({ ...target, file_sha: entry.sha })
    if (blob.data.encoding !== "base64") continue
    files.push({ path: entry.path, text: Buffer.from(blob.data.content, "base64").toString("utf8") })
  }

  return files
}

/** One file as a commit writes it. Text is UTF-8; a screenshot is a Buffer. */
export interface CommitFile {
  path: string
  content: string | Buffer
}

export interface BranchInput {
  /** `owner/name`. */
  repo: string
  branch: string
}

/** The head commit of a branch, or null when the branch is not there. */
export async function branchSha(
  octokit: Octokit,
  { repo, branch }: BranchInput,
): Promise<string | null> {
  const target = parseRepo(repo)

  try {
    const response = await octokit.rest.git.getRef({ ...target, ref: `heads/${branch}` })
    return response.data.object.sha
  } catch (cause) {
    if (isNotFound(cause)) return null
    throw new GitHubError(`Could not read ${repo}#${branch}. ${describe(cause)}`, { cause })
  }
}

/** The head commit of a branch, as something a person can be shown. */
export interface BranchCommit {
  sha: string
  committedAt: Date
  /** Where the commit can be read on GitHub. */
  url: string
}

/**
 * When a branch last moved. A read, so no allowlist check: the gate is on
 * writes. Returns null when the branch is not there, which is how the
 * conventions page tells "never synced" from "synced and unreachable".
 */
export async function branchCommit(
  octokit: Octokit,
  { repo, branch }: BranchInput,
): Promise<BranchCommit | null> {
  const target = parseRepo(repo)

  try {
    const response = await octokit.rest.repos.getBranch({ ...target, branch })
    const committed =
      response.data.commit.commit.committer?.date ?? response.data.commit.commit.author?.date

    return {
      sha: response.data.commit.sha,
      committedAt: committed ? new Date(committed) : new Date(0),
      url: response.data.commit.html_url,
    }
  } catch (cause) {
    if (isNotFound(cause)) return null
    throw new GitHubError(`Could not read ${repo}#${branch}. ${describe(cause)}`, { cause })
  }
}

export interface EnsureBranchInput extends BranchInput {
  /** Branch the new one starts from. Ignored when the branch already exists. */
  fromRef: string
}

export interface EnsureBranchResult {
  sha: string
  created: boolean
}

/** Creates a branch off `fromRef` unless it is already there. A write. */
export async function ensureBranch(
  octokit: Octokit,
  { repo, branch, fromRef }: EnsureBranchInput,
): Promise<EnsureBranchResult> {
  assertRepoAllowed(repo)
  const target = parseRepo(repo)

  const existing = await branchSha(octokit, { repo, branch })
  if (existing) return { sha: existing, created: false }

  const base = await branchSha(octokit, { repo, branch: fromRef })
  if (!base) {
    throw new GitHubError(`${repo} has no branch ${fromRef} to start ${branch} from.`)
  }

  try {
    const response = await octokit.rest.git.createRef({
      ...target,
      ref: `refs/heads/${branch}`,
      sha: base,
    })
    return { sha: response.data.object.sha, created: true }
  } catch (cause) {
    throw new GitHubError(`Could not create ${repo}#${branch}. ${describe(cause)}`, { cause })
  }
}

export interface CommitFilesInput extends BranchInput {
  message: string
  files: readonly CommitFile[]
}

export interface CommitResult {
  /** Head of the branch after the call. */
  sha: string
  /** False when the files were already exactly what the branch holds. */
  changed: boolean
}

/**
 * Writes files onto an existing branch as one commit. A write.
 *
 * Built through the git data API rather than the contents API so several files
 * land in a single commit, and so a commit that would change nothing is
 * detected before it is made: the tree GitHub builds from the blobs is compared
 * against the tree already on the branch, and an identical one is not committed.
 * That is what lets the rules file be regenerated on every convention change
 * without filling a branch with empty commits.
 */
export async function commitFiles(
  octokit: Octokit,
  { repo, branch, message, files }: CommitFilesInput,
): Promise<CommitResult> {
  assertRepoAllowed(repo)
  const target = parseRepo(repo)

  const head = await branchSha(octokit, { repo, branch })
  if (!head) {
    throw new GitHubError(`${repo} has no branch ${branch} to commit to.`)
  }

  try {
    const parent = await octokit.rest.git.getCommit({ ...target, commit_sha: head })

    const entries = []
    for (const file of files) {
      const blob = await octokit.rest.git.createBlob({
        ...target,
        content:
          typeof file.content === "string"
            ? Buffer.from(file.content, "utf8").toString("base64")
            : file.content.toString("base64"),
        encoding: "base64",
      })
      entries.push({
        path: file.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha: blob.data.sha,
      })
    }

    const tree = await octokit.rest.git.createTree({
      ...target,
      base_tree: parent.data.tree.sha,
      tree: entries,
    })

    if (tree.data.sha === parent.data.tree.sha) return { sha: head, changed: false }

    const commit = await octokit.rest.git.createCommit({
      ...target,
      message,
      tree: tree.data.sha,
      parents: [head],
    })
    await octokit.rest.git.updateRef({
      ...target,
      ref: `heads/${branch}`,
      sha: commit.data.sha,
    })

    return { sha: commit.data.sha, changed: true }
  } catch (cause) {
    if (cause instanceof GitHubError) throw cause
    throw new GitHubError(`Could not commit to ${repo}#${branch}. ${describe(cause)}`, { cause })
  }
}

export interface PullRequestInput {
  /** `owner/name`. */
  repo: string
  /** Branch the change is on. */
  head: string
  /** Branch it is proposed against. */
  base: string
  title: string
  body: string
}

export interface PullRequestRef {
  number: number
  url: string
  /** False when a pull request for this branch was already open. */
  created: boolean
}

/**
 * Opens a pull request, or returns the one already open for the branch. A
 * write. Idempotent on purpose: resolving the same finding twice updates a
 * pull request rather than stacking a second one beside it.
 */
export async function openPullRequest(
  octokit: Octokit,
  { repo, head, base, title, body }: PullRequestInput,
): Promise<PullRequestRef> {
  assertRepoAllowed(repo)
  const target = parseRepo(repo)

  const open = await octokit.rest.pulls.list({
    ...target,
    head: `${target.owner}:${head}`,
    state: "open",
  })
  const existing = open.data[0]
  if (existing) {
    await octokit.rest.pulls.update({ ...target, pull_number: existing.number, title, body })
    return { number: existing.number, url: existing.html_url, created: false }
  }

  try {
    const response = await octokit.rest.pulls.create({ ...target, head, base, title, body })
    return { number: response.data.number, url: response.data.html_url, created: true }
  } catch (cause) {
    throw new GitHubError(`Could not open a pull request on ${repo}. ${describe(cause)}`, { cause })
  }
}

/**
 * A file on a branch as a URL an image tag can load. The `refs/heads/` form is
 * used because a branch name carrying a slash is otherwise ambiguous with a
 * path.
 */
/**
 * Where a pull request lives, from the number stored on a finding. Built rather
 * than stored: a finding records the number GitHub answered with, and the
 * address of that number is a fact about GitHub rather than about the finding.
 */
export function pullRequestUrl(repo: string, number: number): string {
  const { owner, repo: name } = parseRepo(repo)
  return `https://github.com/${owner}/${name}/pull/${number}`
}

/** A branch as a URL a person can open. */
export function branchUrl(repo: string, branch: string): string {
  const { owner, repo: name } = parseRepo(repo)
  return `https://github.com/${owner}/${name}/tree/${encodeURIComponent(branch)}`
}

export function rawFileUrl(repo: string, branch: string, path: string): string {
  const { owner, repo: name } = parseRepo(repo)
  const encoded = path.split("/").map(encodeURIComponent).join("/")
  return `https://raw.githubusercontent.com/${owner}/${name}/refs/heads/${branch}/${encoded}`
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
