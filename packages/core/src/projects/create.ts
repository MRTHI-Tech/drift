/**
 * Creating a watched project, once and in one place.
 *
 * Both callers come through here: the dashboard's add dialog and `pnpm seed`.
 * That is the same arrangement `resolveFinding` has, and for the same reason. A
 * project created from a browser and a project created from a terminal are the
 * same document, with the same defaults and the same uniqueness rule, because
 * there is one function that knows how to make one.
 *
 * The uniqueness rule is one project per repo. Two projects watching the same
 * repo would race each other's branches and each other's pull requests, and
 * `findByRepo` is what the deploy webhook uses to decide which project a push
 * belongs to, so a second one would make that lookup ambiguous.
 */

import { createLogger, type Logger } from "../logging"
import type { Repositories } from "../repositories"
import type { Project } from "../types"
import {
  normalizeProjectInput,
  type NormalizedProjectInput,
  type ProjectInput,
  type ProjectIssue,
} from "./input"

/** Raised when a project cannot be created. Carries a message a person can act on. */
export class ProjectError extends Error {
  override readonly name: string = "ProjectError"
}

/** Raised when what was typed is not usable. Carries one issue per bad field. */
export class ProjectInputError extends ProjectError {
  override readonly name = "ProjectInputError"
  readonly issues: readonly ProjectIssue[]

  constructor(issues: readonly ProjectIssue[]) {
    super(issues.map((issue) => issue.message).join(" "))
    this.issues = issues
  }
}

/** Raised when a project already watches the repo. Names the one that does. */
export class ProjectExistsError extends ProjectError {
  override readonly name = "ProjectExistsError"
  readonly existing: Project

  constructor(existing: Project) {
    super(`${existing.repo} is already watched, by ${existing.name}.`)
    this.existing = existing
  }
}

export interface CreateProjectInput {
  input: ProjectInput
  repositories: Repositories
  logger?: Logger
}

/**
 * Writes one `projects` document and nothing else. No run, no screens, no
 * findings: starting the first run is a separate decision made by the caller,
 * because the terminal and the dashboard answer it differently.
 */
export async function createProject({
  input,
  repositories,
  logger = createLogger(),
}: CreateProjectInput): Promise<Project> {
  const normalized = normalizeProjectInput(input)
  if (!normalized.ok) throw new ProjectInputError(normalized.issues)

  const value = normalized.value

  const existing = await repositories.projects.findByRepo(value.repo)
  if (existing) throw new ProjectExistsError(existing)

  const project = await repositories.projects.create(newProject(value))

  logger.log("project.created", {
    projectId: project.id,
    name: project.name,
    repo: project.repo,
    previewUrl: project.previewUrl,
    defaultBranch: project.defaultBranch,
    configPath: project.configPath,
  })

  return project
}

/**
 * The document a new project starts as. The score starts at 0 and `lastRunAt`
 * at null, both of which are true rather than optimistic: nothing has been
 * checked yet, and a score is open findings over screens checked.
 */
function newProject(value: NormalizedProjectInput): Omit<Project, "id"> {
  return {
    name: value.name,
    repo: value.repo,
    previewUrl: value.previewUrl,
    defaultBranch: value.defaultBranch,
    configPath: value.configPath,
    installationId: value.installationId,
    createdAt: new Date(),
    driftScore: 0,
    lastRunAt: null,
  }
}
