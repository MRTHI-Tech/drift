/**
 * What Drift checks before it agrees to watch something.
 *
 * Every way a run fails traces back to one of four things being wrong, and all
 * four can be asked in about two seconds while somebody is still looking at the
 * form. The alternative is a `runs` document with `status: error` ten minutes
 * later, which is the same information delivered somewhere nobody is watching.
 *
 * Two of the four block, and two do not. A repo Drift cannot read and a config
 * it cannot parse leave nothing to render, so they stop the save. A preview that
 * did not answer and a token file that did not parse cost a run some of what it
 * would have found and none of what it would have rendered, so they are said
 * plainly and the person decides. That split is the same one the worker already
 * makes at run time (`tokens.missing` costs a run its token findings, not its
 * screens), and the two have to agree.
 *
 * Nothing here throws. A check that could not be made is a check that says so.
 */

import type { Octokit } from "@octokit/rest"

import { TOKEN_GROUPS, type TokenGroup, type TokenSet } from "../analysis/tokens"
import { DriftConfigError, type DriftConfig } from "../config"
import {
  fetchDriftConfig,
  fetchRepoFile,
  fetchRepoMetadata,
  fetchTokenDefinitions,
  isRepoAllowed,
  repoAllowlist,
  type RepoMetadata,
} from "../github"
import { errorMessage } from "../logging"
import type { NormalizedProjectInput } from "./input"

/** What one check concluded. `warn` does not block a save; `fail` does. */
export type CheckStatus = "pass" | "warn" | "fail" | "skipped"

/** The four things asked, in the order they are asked. */
export type CheckId = "repo" | "config" | "preview" | "tokens"

/** One check, as the dialog renders it. */
export interface PreflightCheck {
  id: CheckId
  status: CheckStatus
  /** One line, evidence first, in the voice of AGENTS.md section 6. */
  message: string
  /** What to do about it. Null when there is nothing to do. */
  remedy: string | null
}

/** The two things that are true of a project without being checks it can fail. */
export interface PreflightAdvisories {
  /** Whether `GITHUB_REPO_ALLOWLIST` lets Drift write to this repo at all. */
  allowlisted: boolean
  /** Set when the config asks for a session cookie the environment has to carry. */
  authCookie: { name: string; valueSet: boolean } | null
}

export interface PreflightResult {
  checks: PreflightCheck[]
  /** True when nothing failed. Warnings do not stop a project being created. */
  ok: boolean
  /** GitHub's own answer about the repo, or null when it could not be read. */
  repo: RepoMetadata | null
  /** The parsed config, or null when there is none or it did not parse. */
  config: DriftConfig | null
  /** True only when the repo has no config file at all, which is fixable from here. */
  configMissing: boolean
  advisories: PreflightAdvisories
}

export interface PreflightInput {
  octokit: Octokit
  input: NormalizedProjectInput
  /** Injected so a test can answer for the preview without a network. */
  fetchImpl?: typeof fetch
  /** Injected so a test does not depend on the process environment. */
  allowlist?: readonly string[]
  previewAuthCookieValue?: string | undefined
}

/** How long the preview is given to answer before the check gives up on it. */
export const PREVIEW_TIMEOUT_MS = 10_000

/** Runs all four checks. Later checks read what earlier ones found. */
export async function preflight(input: PreflightInput): Promise<PreflightResult> {
  const {
    octokit,
    input: project,
    fetchImpl = fetch,
    allowlist = repoAllowlist(),
    previewAuthCookieValue = process.env.PREVIEW_AUTH_COOKIE_VALUE,
  } = input

  const repo = await checkRepo(octokit, project)

  // Every check after the first reads the branch GitHub reported rather than
  // the one the input carried. Nobody is asked for a default branch, so the
  // input's is only ever the constant default, and a repo whose default is
  // `master` would otherwise fail a config check for a file that is there.
  const resolved: NormalizedProjectInput = {
    ...project,
    defaultBranch: repo.metadata?.defaultBranch ?? project.defaultBranch,
  }

  const config = await checkConfig(octokit, resolved, repo.metadata !== null)
  const preview = await checkPreview(resolved, config.value, fetchImpl)
  const tokens = await checkTokens(octokit, resolved, config.value)

  return {
    checks: [repo.check, config.check, preview, tokens],
    ok: ![repo.check, config.check, preview, tokens].some((check) => check.status === "fail"),
    repo: repo.metadata,
    config: config.value,
    configMissing: config.missing,
    advisories: {
      allowlisted: isRepoAllowed(project.repo, allowlist),
      authCookie: config.value?.authCookieName
        ? {
            name: config.value.authCookieName,
            valueSet: (previewAuthCookieValue ?? "").length > 0,
          }
        : null,
    },
  }
}

/**
 * Can this token see this repo? A typo, a private repo, and a PAT missing the
 * repository both look identical from here, so the message names all three
 * rather than picking one.
 */
async function checkRepo(
  octokit: Octokit,
  project: NormalizedProjectInput,
): Promise<{ check: PreflightCheck; metadata: RepoMetadata | null }> {
  try {
    const metadata = await fetchRepoMetadata(octokit, project.repo)

    if (!metadata) {
      return {
        metadata: null,
        check: {
          id: "repo",
          status: "fail",
          message: `GitHub has no ${project.repo} that this token can see.`,
          remedy:
            "Check the spelling. If the repo is private, GITHUB_TOKEN needs to be granted it.",
        },
      }
    }

    return {
      metadata,
      check: {
        id: "repo",
        status: "pass",
        message: `${metadata.repo} is readable, and its default branch is ${metadata.defaultBranch}.`,
        remedy: null,
      },
    }
  } catch (error) {
    return {
      metadata: null,
      check: {
        id: "repo",
        status: "fail",
        message: `Could not reach GitHub for ${project.repo}. ${errorMessage(error)}`,
        remedy: "This one may go differently in a minute.",
      },
    }
  }
}

/**
 * Is there a config, and does it say something Drift can act on? This is the
 * check that earns the others: the config is the only declaration of what gets
 * rendered (AGENTS.md section 2a), and its schema is strict, so a misspelled key
 * is caught here rather than silently ignored for the life of the project.
 */
async function checkConfig(
  octokit: Octokit,
  project: NormalizedProjectInput,
  repoReadable: boolean,
): Promise<{ check: PreflightCheck; value: DriftConfig | null; missing: boolean }> {
  if (!repoReadable) {
    return {
      value: null,
      missing: false,
      check: {
        id: "config",
        status: "skipped",
        message: "Not checked, because the repo could not be read.",
        remedy: null,
      },
    }
  }

  // Asked separately from the parse so a file that is not there reads
  // differently from a file that is there and wrong. Only the first is
  // something Drift can offer to fix.
  let present: string | null
  try {
    present = await fetchRepoFile(octokit, {
      repo: project.repo,
      path: project.configPath,
      ref: project.defaultBranch,
    })
  } catch (error) {
    return {
      value: null,
      missing: false,
      check: {
        id: "config",
        status: "fail",
        message: `Could not read ${project.configPath}. ${errorMessage(error)}`,
        remedy: null,
      },
    }
  }

  if (present === null) {
    return {
      value: null,
      missing: true,
      check: {
        id: "config",
        status: "fail",
        message: `${project.repo} has no ${project.configPath} on ${project.defaultBranch}.`,
        remedy: "Drift can write one for you, or you can add it yourself.",
      },
    }
  }

  try {
    const value = await fetchDriftConfig(octokit, {
      repo: project.repo,
      configPath: project.configPath,
      defaultBranch: project.defaultBranch,
    })

    return {
      value,
      missing: false,
      check: {
        id: "config",
        status: "pass",
        message: describeConfig(value),
        remedy: null,
      },
    }
  } catch (error) {
    // A config that exists and is wrong is a file a person owns
    // (AGENTS.md section 10b). Drift reports it and changes nothing.
    return {
      value: null,
      missing: false,
      check: {
        id: "config",
        status: "fail",
        message:
          error instanceof DriftConfigError
            ? errorMessage(error)
            : `${project.configPath} could not be read. ${errorMessage(error)}`,
        remedy: "Drift does not edit a config that is already there. Fix it in the repo.",
      },
    }
  }
}

/**
 * Does the preview answer, and does it answer for a route the config declares?
 * The second half is the part worth having. A preview URL pointing at a
 * different deployment than the config describes still answers on `/`, and
 * would otherwise produce a full run of screens that are quietly the wrong
 * product.
 */
async function checkPreview(
  project: NormalizedProjectInput,
  config: DriftConfig | null,
  fetchImpl: typeof fetch,
): Promise<PreflightCheck> {
  // The dialog inspects a repo before a preview URL has been typed, so that it
  // can say what the repo declares while somebody is still filling the form in.
  if (!project.previewUrl) {
    return {
      id: "preview",
      status: "skipped",
      message: "Not checked yet, because no preview URL has been given.",
      remedy: null,
    }
  }

  const route = config?.routes[0] ?? "/"
  const url = previewTarget(project.previewUrl, route)

  const answer = await probe(url, fetchImpl)

  if (!answer.reached) {
    return {
      id: "preview",
      status: "warn",
      message: `${url} did not answer. ${answer.detail}`,
      remedy: "The project can still be added. Its first run will fail until the preview is up.",
    }
  }

  if (answer.status >= 400) {
    return {
      id: "preview",
      status: "warn",
      message: `${url} answered ${answer.status}.`,
      remedy: config
        ? `${route} is the first route in ${project.configPath}. Check the preview URL points at the deployment that repo builds.`
        : "Check the preview URL.",
    }
  }

  return {
    id: "preview",
    status: "pass",
    message: `${url} answered ${answer.status}.`,
    remedy: null,
  }
}

/**
 * Does the token file parse? A project with no readable tokens still renders,
 * still signs, and still finds pattern drift. It just raises no token findings,
 * which is what the worker already does at run time.
 */
async function checkTokens(
  octokit: Octokit,
  project: NormalizedProjectInput,
  config: DriftConfig | null,
): Promise<PreflightCheck> {
  if (!config) {
    return {
      id: "tokens",
      status: "skipped",
      message: "Not checked, because the config could not be read.",
      remedy: null,
    }
  }

  if (!config.tokenDefinitionsPath) {
    return {
      id: "tokens",
      status: "warn",
      message: `${project.configPath} declares no tokenDefinitionsPath.`,
      remedy: "Without one Drift finds pattern drift but no token drift.",
    }
  }

  try {
    const tokens = await fetchTokenDefinitions(
      octokit,
      { repo: project.repo, defaultBranch: project.defaultBranch },
      config.tokenDefinitionsPath,
    )

    if (!tokens) {
      return {
        id: "tokens",
        status: "warn",
        message: `${config.tokenDefinitionsPath} is not on ${project.defaultBranch}.`,
        remedy: "Runs will render and sign, and raise no token findings, until that path is right.",
      }
    }

    return {
      id: "tokens",
      status: "pass",
      message: describeTokens(tokens.path, tokens.tokens),
      remedy: null,
    }
  } catch (error) {
    return {
      id: "tokens",
      status: "warn",
      message: `${config.tokenDefinitionsPath} could not be read. ${errorMessage(error)}`,
      remedy: "Runs will render and sign, and raise no token findings, until it can be.",
    }
  }
}

/** The URL a route sits at, matching how the worker builds one. */
function previewTarget(previewUrl: string, route: string): string {
  return `${previewUrl.replace(/\/+$/, "")}${route}`
}

interface Probe {
  reached: boolean
  status: number
  detail: string
}

/**
 * One request, with a timeout, that never throws. A preview is somebody else's
 * server and every way it can fail is information rather than an exception.
 */
async function probe(url: string, fetchImpl: typeof fetch): Promise<Probe> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, PREVIEW_TIMEOUT_MS)

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    })
    return { reached: true, status: response.status, detail: "" }
  } catch (error) {
    const aborted = controller.signal.aborted
    return {
      reached: false,
      status: 0,
      detail: aborted
        ? `Nothing came back within ${PREVIEW_TIMEOUT_MS / 1000} seconds.`
        : errorMessage(error),
    }
  } finally {
    clearTimeout(timer)
  }
}

/** What the config says, as one line somebody can check against what they expect. */
function describeConfig(config: DriftConfig): string {
  const routes = config.routes.length === 1 ? "1 route" : `${config.routes.length} routes`
  return `${routes} at ${config.viewports.join(" and ")}.`
}

/** What each token group is called in a sentence a person reads. */
const GROUP_NOUNS: Record<TokenGroup, string> = {
  color: "colours",
  spacing: "spacing steps",
  fontSize: "type sizes",
  fontWeight: "weights",
  radius: "radii",
}

/** What the token file holds, counted rather than described. */
function describeTokens(path: string, tokens: TokenSet): string {
  const counted = TOKEN_GROUPS.filter((group) => tokens[group].length > 0).map(
    (group) => `${tokens[group].length} ${GROUP_NOUNS[group]}`,
  )

  if (counted.length === 0) return `${path} parsed, and declares no scale Drift reads.`
  return `${path} declares ${counted.join(", ")}.`
}
