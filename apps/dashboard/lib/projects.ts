/**
 * The shared body of the two project routes: inspecting a repo, and starting to
 * watch it.
 *
 * Both are behind the session (AGENTS.md section 1). Inspect reads somebody
 * else's repository through Drift's token, and create writes to Firestore and
 * may open a pull request, so neither is a thing an unauthenticated caller does.
 *
 * The work itself is `preflight` and `createProject` in `@drift/core`, which is
 * also what `pnpm seed` calls. What lives here is the translation between an
 * HTTP body and those functions, and nothing else.
 */

import {
  composeConfigProposal,
  createGitHubClient,
  createLogger,
  createProject,
  createRepositories,
  DEFAULT_CONFIG_PATH,
  errorMessage,
  normalizeRepo,
  openConfigPullRequest,
  preflight,
  ProjectExistsError,
  ProjectInputError,
  repoIssue,
  startFirstRun,
  type ConfigProposal,
  type NormalizedProjectInput,
  type PreflightResult,
} from "@drift/core"

/** What both routes take. Only `repo` is needed to inspect. */
export interface ProjectRequestBody {
  repo: string
  name?: string
  previewUrl?: string
  configPath?: string
  /** Create only: also propose a `drift.config.json` when the repo has none. */
  proposeConfig?: boolean
}

/** Reads a JSON body without trusting any of it. */
export async function readProjectBody(request: Request): Promise<ProjectRequestBody> {
  let value: unknown
  try {
    value = await request.json()
  } catch {
    value = null
  }

  const record = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >

  return {
    repo: typeof record.repo === "string" ? record.repo : "",
    name: typeof record.name === "string" ? record.name : undefined,
    previewUrl: typeof record.previewUrl === "string" ? record.previewUrl : undefined,
    configPath: typeof record.configPath === "string" ? record.configPath : undefined,
    proposeConfig: record.proposeConfig === true,
  }
}

/**
 * What preflight was run against. The name is not part of it: it is not checked
 * against anything, and a project can be renamed.
 */
export function inspectionTarget(body: ProjectRequestBody): NormalizedProjectInput {
  return {
    name: "",
    repo: normalizeRepo(body.repo),
    previewUrl: (body.previewUrl ?? "").trim(),
    // Replaced by whatever GitHub reports, inside preflight.
    defaultBranch: "main",
    configPath: (body.configPath ?? "").trim() || DEFAULT_CONFIG_PATH,
  }
}

/** The inspection, and the config Drift would propose when there is none. */
export interface Inspection extends PreflightResult {
  /** The repo as it will be stored, so the dialog and the create call agree. */
  repoSlug: string
  /** Composed only when the repo has no config. Null otherwise. */
  proposal: ConfigProposal | null
  /** Whether Drift could open that proposal, which needs the allowlist. */
  canProposeConfig: boolean
}

/**
 * Runs the four checks, and composes a config when the repo has none. The
 * proposal is composed whether or not Drift may write to the repo, because a
 * file somebody copies by hand is worth as much as one in a pull request.
 */
export async function inspectRepo(body: ProjectRequestBody): Promise<Inspection> {
  const octokit = createGitHubClient()
  const input = inspectionTarget(body)

  const result = await preflight({ octokit, input })

  const proposal = result.configMissing
    ? await composeConfigProposal({
        octokit,
        project: {
          ...input,
          defaultBranch: result.repo?.defaultBranch ?? input.defaultBranch,
        },
      })
    : null

  return {
    ...result,
    repoSlug: input.repo,
    proposal,
    canProposeConfig: proposal !== null && result.advisories.allowlisted,
  }
}

/** Everything the dialog is told after a project is created. */
export interface CreatedProject {
  projectId: string
  name: string
  repo: string
  firstRun: { started: boolean; executionId: string | null; command: string | null; reason: string | null }
  configPullRequest: { number: number; url: string } | null
  configPullRequestError: string | null
}

/**
 * Creates the project, opens the config pull request when one was asked for,
 * and starts the first run.
 *
 * The order matters. The project is written first, because it is the thing
 * being asked for; the other two are things that happen to a project that
 * exists. Neither of them failing un-creates it, and both report what went
 * wrong instead of throwing it, because a project that exists with no run is
 * recoverable by one command and a project that silently did not get created is
 * not.
 */
export async function createWatchedProject(body: ProjectRequestBody): Promise<CreatedProject> {
  const repositories = createRepositories()
  const logger = createLogger()

  const octokit = createGitHubClient()
  const input = inspectionTarget(body)

  // GitHub owns the default branch. Asked again here rather than trusted from
  // an earlier inspection, because a body is a body.
  const inspected = await preflight({ octokit, input })
  const defaultBranch = inspected.repo?.defaultBranch ?? input.defaultBranch

  const project = await createProject({
    input: {
      name: body.name ?? "",
      repo: body.repo,
      previewUrl: body.previewUrl ?? "",
      defaultBranch,
      configPath: input.configPath,
    },
    repositories,
    logger,
  })

  let configPullRequest: CreatedProject["configPullRequest"] = null
  let configPullRequestError: string | null = null

  if (body.proposeConfig && inspected.configMissing) {
    try {
      const proposal = await composeConfigProposal({
        octokit,
        project: { ...input, defaultBranch },
      })
      const opened = await openConfigPullRequest({
        octokit,
        project: { ...input, defaultBranch },
        proposal,
        logger,
      })
      configPullRequest = { number: opened.prNumber, url: opened.url }
    } catch (error) {
      configPullRequestError = errorMessage(error)
      logger.error("config.pull_request_failed", {
        projectId: project.id,
        repo: input.repo,
        message: configPullRequestError,
      })
    }
  }

  const firstRun = await startFirstRun({ project, logger })

  return {
    projectId: project.id,
    name: project.name,
    repo: project.repo,
    firstRun: {
      started: firstRun.started,
      executionId: firstRun.executionId,
      command: firstRun.command,
      reason: firstRun.reason,
    },
    configPullRequest,
    configPullRequestError,
  }
}

/** A repo that is not one yet, as a 400 the dialog can put under the field. */
export function repoRejection(body: ProjectRequestBody): Response | null {
  const issue = repoIssue(body.repo)
  if (!issue) return null
  return Response.json({ error: issue, field: "repo" }, { status: 400 })
}

/** Turns anything `createProject` throws into the status it deserves. */
export function creationFailure(error: unknown): Response {
  if (error instanceof ProjectInputError) {
    return Response.json({ error: error.message, issues: error.issues }, { status: 400 })
  }
  if (error instanceof ProjectExistsError) {
    return Response.json(
      { error: error.message, field: "repo", existingProjectId: error.existing.id },
      { status: 409 },
    )
  }
  return Response.json({ error: errorMessage(error) }, { status: 500 })
}
