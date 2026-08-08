/**
 * A `drift.config.json` for a repo that has none.
 *
 * This is a setup file under AGENTS.md section 10b, not a patch under 10a: the
 * file is composed whole against the schema in `config.ts`, nothing about it
 * depends on reading the watched repo's code, and it is only ever written where
 * there is no config already. A config that exists is a file a person owns, and
 * an invalid one is reported and left alone.
 *
 * What it proposes is deliberately small. Routes are the one thing Drift cannot
 * know and will not guess: Drift never crawls (section 9), so the proposal
 * declares `/` and says in the pull request that the rest is the person's to
 * add. The token path is different, because it is a yes or no question about a
 * fixed list of paths rather than a discovery: each candidate is read, and one
 * that parses is filled in.
 */

import type { Octokit } from "@octokit/rest"

import { parseTokenDefinitions } from "../analysis/tokens"
import { VIEWPORTS } from "../constants"
import {
  assertRepoAllowed,
  commitFiles,
  ensureBranch,
  fetchRepoFile,
  openPullRequest,
} from "../github"
import { createLogger, type Logger } from "../logging"
import { OPENED_BY_DRIFT } from "../actuation/constants"
import type { NormalizedProjectInput } from "./input"

/** Branch a proposed config is opened on. Section 10b names it. */
export const CONFIG_BRANCH = "drift/config"

/**
 * Where token files usually are. A fixed list, read in order, because asking
 * whether a known path exists is a different thing from searching a repo for
 * one. The first that parses into any token at all wins.
 */
export const TOKEN_PATH_CANDIDATES: readonly string[] = [
  "constants/theme.ts",
  "constants/tokens.ts",
  "lib/theme.ts",
  "lib/tokens.ts",
  "src/theme.ts",
  "src/tokens.ts",
  "src/styles/tokens.ts",
  "theme.ts",
  "tokens.json",
  "design-tokens.json",
  "src/tokens.json",
]

export interface ConfigProposal {
  /** The file, exactly as it would be committed. */
  content: string
  path: string
  /** The token path that was found, or null when none of the candidates parsed. */
  tokenDefinitionsPath: string | null
}

export interface ProposeConfigInput {
  octokit: Octokit
  project: NormalizedProjectInput
}

/**
 * Composes the file. Reads the repo only to test the candidate token paths, and
 * writes nothing, so this is safe to call for a repo Drift may not write to: the
 * result is still worth showing somebody to copy by hand.
 */
export async function composeConfigProposal(input: ProposeConfigInput): Promise<ConfigProposal> {
  const tokenDefinitionsPath = await findTokenPath(input)

  const config: Record<string, unknown> = {
    routes: ["/"],
    viewports: [...VIEWPORTS],
  }
  if (tokenDefinitionsPath) config.tokenDefinitionsPath = tokenDefinitionsPath

  return {
    content: `${JSON.stringify(config, null, 2)}\n`,
    path: input.project.configPath,
    tokenDefinitionsPath,
  }
}

export interface OpenConfigPullRequestInput extends ProposeConfigInput {
  proposal: ConfigProposal
  logger?: Logger
}

export interface ConfigPullRequestResult {
  branch: string
  path: string
  prNumber: number
  url: string
  /** False when a pull request for this branch was already open. */
  created: boolean
}

/**
 * Puts the proposal on `drift/config` and opens it as a pull request.
 *
 * The allowlist is asserted first, before anything touches the network, and
 * again inside every write in `github.ts`. The config is checked one last time
 * for having appeared in the meantime, because the gap between inspecting a
 * repo and proposing to it is a gap somebody can commit into, and section 10b
 * says an existing config is never overwritten.
 */
export async function openConfigPullRequest(
  input: OpenConfigPullRequestInput,
): Promise<ConfigPullRequestResult> {
  const { octokit, project, proposal } = input
  const logger = input.logger ?? createLogger()

  assertRepoAllowed(project.repo)

  const existing = await fetchRepoFile(octokit, {
    repo: project.repo,
    path: project.configPath,
    ref: project.defaultBranch,
  })
  if (existing !== null) {
    throw new Error(
      `${project.repo} already has ${project.configPath} on ${project.defaultBranch}. ` +
        "Drift does not overwrite a config that is there. See AGENTS.md section 10b.",
    )
  }

  await ensureBranch(octokit, {
    repo: project.repo,
    branch: CONFIG_BRANCH,
    fromRef: project.defaultBranch,
  })

  await commitFiles(octokit, {
    repo: project.repo,
    branch: CONFIG_BRANCH,
    message: `Add ${project.configPath}`,
    files: [{ path: project.configPath, content: proposal.content }],
  })

  const pullRequest = await openPullRequest(octokit, {
    repo: project.repo,
    head: CONFIG_BRANCH,
    base: project.defaultBranch,
    title: `Add ${project.configPath}`,
    body: configPullRequestBody(project.configPath, proposal),
  })

  logger.log("config.pull_request", {
    repo: project.repo,
    branch: CONFIG_BRANCH,
    path: project.configPath,
    tokenDefinitionsPath: proposal.tokenDefinitionsPath,
    prNumber: pullRequest.number,
    created: pullRequest.created,
  })

  return {
    branch: CONFIG_BRANCH,
    path: project.configPath,
    prNumber: pullRequest.number,
    url: pullRequest.url,
    created: pullRequest.created,
  }
}

/** The first candidate path that holds something parseable, or null. */
async function findTokenPath({ octokit, project }: ProposeConfigInput): Promise<string | null> {
  for (const path of TOKEN_PATH_CANDIDATES) {
    let source: string | null
    try {
      source = await fetchRepoFile(octokit, {
        repo: project.repo,
        path,
        ref: project.defaultBranch,
      })
    } catch {
      // A path that cannot be read is a path this repo does not have.
      continue
    }
    if (source === null) continue

    try {
      const tokens = parseTokenDefinitions(source, path)
      const declared = Object.values(tokens).some((group) => group.length > 0)
      if (declared) return path
    } catch {
      continue
    }
  }

  return null
}

function configPullRequestBody(path: string, proposal: ConfigProposal): string {
  const lines = [
    `This file is how this repo tells Drift what to render. Drift never crawls, so`,
    `every route it checks is a route named here.`,
    "",
    `It starts with \`/\` only. **Add the routes you want watched**, then merge.`,
    "",
  ]

  if (proposal.tokenDefinitionsPath) {
    lines.push(
      `\`tokenDefinitionsPath\` is set to \`${proposal.tokenDefinitionsPath}\`, which is where`,
      "this repo's colours, spacing and type scale were found. Values on a screen that",
      "miss those scales are what Drift reports as token drift.",
      "",
    )
  } else {
    lines.push(
      "No token file was found, so `tokenDefinitionsPath` is not set. Without one Drift",
      "reports pattern drift but no token drift. Add the path to your theme or tokens",
      "file to turn it on.",
      "",
    )
  }

  lines.push(
    `Drift proposed this because ${path} was not here when the project was added. It`,
    "will not change the file again once it exists.",
    "",
    OPENED_BY_DRIFT,
  )

  return lines.join("\n")
}
