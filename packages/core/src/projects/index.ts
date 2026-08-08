/**
 * Everything about starting to watch a project: what a person types, what is
 * checked before Drift agrees to it, the one function that writes the document,
 * the config Drift proposes to a repo that has none, and the first run.
 */

export {
  composeConfigProposal,
  openConfigPullRequest,
  CONFIG_BRANCH,
  TOKEN_PATH_CANDIDATES,
  type ConfigProposal,
  type ConfigPullRequestResult,
  type OpenConfigPullRequestInput,
  type ProposeConfigInput,
} from "./config-proposal"

export {
  createProject,
  ProjectError,
  ProjectExistsError,
  ProjectInputError,
  type CreateProjectInput,
} from "./create"

export {
  confirmationProblem,
  countProjectContents,
  deleteProject,
  firestoreEraser,
  OWNED_COLLECTIONS,
  ProjectConfirmationError,
  ProjectNotFoundError,
  type DeleteProjectInput,
  type DeleteProjectResult,
  type OwnedCollection,
  type ProjectContents,
  type ProjectEraser,
} from "./delete"

export { startFirstRun, workerCommand, type FirstRunResult, type StartFirstRunInput } from "./first-run"

export {
  normalizeProjectInput,
  normalizeRepo,
  projectNameFromRepo,
  repoIssue,
  type NormalizedProjectInput,
  type NormalizeResult,
  type ProjectField,
  type ProjectInput,
  type ProjectIssue,
} from "./input"

export {
  preflight,
  PREVIEW_TIMEOUT_MS,
  type CheckId,
  type CheckStatus,
  type PreflightAdvisories,
  type PreflightCheck,
  type PreflightInput,
  type PreflightResult,
} from "./preflight"
