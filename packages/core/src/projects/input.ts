/**
 * What a person types to start watching a project, and what it has to become
 * before Firestore sees it.
 *
 * Three fields (AGENTS.md section 9): a name, a repo, and a preview URL.
 * Everything else about a watched project is read out of the repo rather than
 * asked for, because `drift.config.json` is the only declaration of what Drift
 * renders (section 2a) and a second place to state it would be a second truth.
 *
 * Validation returns its problems rather than throwing them, one per field, so
 * a form can put each message under the input it belongs to. Nothing here
 * touches the network: these are the checks that can be made from the strings
 * alone, and the four that need GitHub or the preview live in `preflight.ts`.
 */

import { DEFAULT_BRANCH, DEFAULT_CONFIG_PATH } from "../constants"

/** The fields a person fills in. The last two are defaulted, not asked. */
export interface ProjectInput {
  name: string
  /** `owner/name`, or a GitHub URL that carries one. */
  repo: string
  previewUrl: string
  defaultBranch?: string
  configPath?: string
}

/** The same fields, trimmed and settled, as a project document will hold them. */
export interface NormalizedProjectInput {
  name: string
  repo: string
  previewUrl: string
  defaultBranch: string
  configPath: string
}

/** Which input a problem belongs under. */
export type ProjectField = keyof ProjectInput

/** One problem with one field, in the voice of AGENTS.md section 6. */
export interface ProjectIssue {
  field: ProjectField
  message: string
}

export type NormalizeResult =
  | { ok: true; value: NormalizedProjectInput }
  | { ok: false; issues: ProjectIssue[] }

const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

/**
 * Cleans up what was typed and says what is still wrong with it. Every issue is
 * reported at once rather than one at a time, so a form fills in its messages in
 * a single pass.
 */
export function normalizeProjectInput(input: ProjectInput): NormalizeResult {
  const issues: ProjectIssue[] = []

  const repo = normalizeRepo(input.repo)
  const badRepo = repoIssue(input.repo)
  if (badRepo) issues.push({ field: "repo", message: badRepo })

  const name = input.name.trim()
  if (!name) {
    issues.push({ field: "name", message: "A name is required." })
  }

  const previewUrl = input.previewUrl.trim()
  if (!previewUrl) {
    issues.push({ field: "previewUrl", message: "A preview URL is required." })
  } else {
    const problem = urlProblem(previewUrl)
    if (problem) issues.push({ field: "previewUrl", message: problem })
  }

  const defaultBranch = (input.defaultBranch ?? "").trim() || DEFAULT_BRANCH
  const configPath = (input.configPath ?? "").trim() || DEFAULT_CONFIG_PATH

  if (configPath.startsWith("/")) {
    issues.push({
      field: "configPath",
      message: "A config path is relative to the repo root, so it does not start with /.",
    })
  }

  if (issues.length > 0) return { ok: false, issues }

  return {
    ok: true,
    value: { name, repo, previewUrl, defaultBranch, configPath },
  }
}

/**
 * Why what was typed is not a repo, or null when it is. Exported on its own
 * because inspecting a repo happens before the rest of the form is filled in,
 * and that path needs this one answer rather than all of them.
 */
export function repoIssue(raw: string): string | null {
  const repo = normalizeRepo(raw)
  if (!repo) return "A repo is required."
  if (!REPO_PATTERN.test(repo)) return `A repo reads owner/name. This reads ${repo}.`
  return null
}

/**
 * `owner/name` out of whatever was pasted. A repo is most often copied from the
 * address bar, so a GitHub URL is accepted and reduced rather than rejected for
 * being one.
 */
export function normalizeRepo(raw: string): string {
  let value = raw.trim()
  if (!value) return ""

  value = value.replace(/^git@github\.com:/i, "")
  value = value.replace(/^https?:\/\/(www\.)?github\.com\//i, "")
  value = value.replace(/^\/+|\/+$/g, "")
  value = value.replace(/\.git$/i, "")

  // A URL carrying a path past the repo, like /owner/name/tree/main.
  const parts = value.split("/")
  if (parts.length > 2) value = parts.slice(0, 2).join("/")

  return value
}

/**
 * A name to put in the field before the person edits it. The repo's own name,
 * in sentence case (AGENTS.md section 6), because that is the only thing Drift
 * knows about a repo before it has read anything out of it.
 */
export function projectNameFromRepo(repo: string): string {
  const name = normalizeRepo(repo).split("/")[1] ?? ""
  if (!name) return ""

  const words = name.split(/[-_.]+/).filter(Boolean)
  if (words.length === 0) return ""

  const [first = "", ...rest] = words
  const head = (first[0]?.toUpperCase() ?? "") + first.slice(1)
  return [head, ...rest].join(" ")
}

/** Why a preview URL is not one, or null when it is. */
function urlProblem(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return `A preview URL is a URL. This reads ${value}.`
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return `A preview URL is http or https. This one is ${url.protocol.replace(":", "")}.`
  }
  return null
}
