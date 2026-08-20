/**
 * Actuation: everything Drift writes outside its own database.
 *
 * Two things reach a watched repo from here, a pull request carrying a
 * mechanical patch and the generated rules file, and both go out through
 * `packages/core/src/github.ts`, which refuses any repo that is not on
 * `GITHUB_REPO_ALLOWLIST` (AGENTS.md section 8).
 *
 * The patch class is deliberately narrow and permanently so: a label's text and
 * a value that missed its token, substituted literal for literal. Anything
 * needing a judgment about code structure is left for a person. `autonomy.ts`
 * holds the one function deciding what may go out unprompted.
 */

export {
  EVIDENCE_BRANCH,
  EVIDENCE_DIRECTORY,
  MAX_AUTONOMOUS_DISTANCE,
  MAX_FIX_FILES,
  MAX_FIX_LINES,
  MAX_PATCH_OCCURRENCES,
  OPENED_BY_DRIFT,
  PATCHABLE_GROUPS,
  RULES_BRANCH,
  RULES_HEADER,
  RULES_PATH,
  fixBranchName,
} from "./constants"

export { isAutonomousFix, type AutonomyDecision, type AutonomyInput } from "./autonomy"

export { evidenceSentence, tokenSentence } from "./evidence"

export {
  gateProposedFix,
  type FixArrival,
  type FixDropReason,
  type FixGateInput,
  type FixGateResult,
  type ProposedEdit,
} from "./fix-gate"

export {
  silentActuationLogger,
  actuationError,
  type ActuationLogger,
} from "./logging"

export {
  patchKindOf,
  patchedPaths,
  planFindingPatch,
  planPatch,
  type FileEdit,
  type PatchAuthor,
  type PatchDirection,
  type PatchKind,
  type PatchPlan,
  type PlanPatchInput,
} from "./patch"

export {
  colorSpellings,
  lengthSpellings,
  sourceSpellings,
  valueGroupOf,
} from "./spellings"

export {
  commitMessage,
  pullRequestBody,
  pullRequestTitle,
  type ComposeInput,
  type EvidenceImage,
  type Opener,
  type PullRequestContent,
} from "./pr"

export {
  openFixPullRequest,
  type OpenFixPullRequestInput,
  type PullRequestResult,
} from "./open-pr"

export {
  renderRulesFile,
  ruleLine,
  summarizeCopyVoice,
  type CopyVoice,
  type RenderRulesInput,
  type RulesArchetype,
} from "./rules"

export {
  composeRulesFile,
  syncRulesFile,
  type RulesSyncResult,
  type SyncRulesFileInput,
} from "./rules-sync"

export {
  RESOLUTION_ACTIONS,
  ResolutionError,
  ResolutionNotFoundError,
  STATUS_OF_ACTION,
  resolveFinding,
  type ResolutionAction,
  type ResolveFindingInput,
  type ResolveFindingResult,
} from "./resolve"

export {
  actuationCandidates,
  observedTextOf,
  openAutonomousPullRequests,
  type AutonomousCandidate,
  type AutonomousRunInput,
  type AutonomousRunResult,
  type FixProposal,
  type FixProposer,
  type FixRequest,
} from "./run-actuation"
