/**
 * `@drift/agent` is the only path to the Gemini API (AGENTS.md section 1), and
 * the judgment phase of a run lives here.
 *
 * The shape of that phase is worth stating once at the door. Everything the
 * model touches sits on top of facts something deterministic already
 * established: signatures and token findings from `@drift/core`, profiles and
 * divergence candidates from this package. A model names families, decides
 * whether a measured divergence matters, and writes one line about it. It never
 * originates a fact, and the reconciliation gate in `reconcile.ts`
 * (AGENTS.md section 3) is what makes that true rather than merely intended.
 */

export { ai } from "./genkit"
export { GEMINI_EMBEDDING_MODEL, GEMINI_MODEL } from "./models"

export {
  ARCHETYPE_SIMILARITY,
  DEFAULT_PATTERN_SEVERITY,
  MAX_FIX_TURNS,
  MAX_READ_LINES,
  MAX_SEARCH_HITS,
  MAX_SENTENCE_LENGTH,
  MIN_SCREENS_PER_ARCHETYPE,
  PATTERN_SEVERITY,
  RETRY_BACKOFF_MS,
} from "./constants"

export { silentLogger, type AgentLogger } from "./logging"
export { attemptOrEmpty, type AttemptOptions } from "./retry"

export {
  PROFILE_PROPERTIES,
  buildProfile,
  firstHeadingSelector,
  profileProperty,
  profileValue,
  resolveLabel,
  severityOf,
  terminalActionSelector,
  type ProfileKind,
  type ProfileProperty,
  type ProfileValue,
  type ProfiledScreen,
  type ScreenProfile,
} from "./profile"

export { centroid, cosineSimilarity, signatureText } from "./embedding"
export {
  archetypeCentroid,
  clusterScreens,
  type ArchetypeCentroid,
  type Assignment,
  type ClusterResult,
  type EmbeddedScreen,
  type NewCluster,
} from "./cluster"

export {
  confidenceOf,
  deriveConventionProposals,
  fallbackLabel,
  type ConventionProposal,
} from "./conventions"

export { divergenceCandidates, type DivergenceCandidate } from "./divergence"

export {
  plainSentence,
  reconcile,
  valueIsRecorded,
  type Assessment,
  type ExtractionSlice,
  type GateResult,
  type JudgedDivergence,
} from "./reconcile"

export {
  patternFinding,
  persistPatternFindings,
  type PatternFindingInput,
  type PatternFindingsResult,
} from "./pattern-findings"

export * from "./flows"

export { fixerFor } from "./fixer"
export {
  listRepoFiles,
  readRepoFile,
  searchRepo,
  type RepoFileSlice,
  type RepoSearchHit,
} from "./repo-tools"

export {
  extractionSlice,
  judgeRun,
  latestPerRoute,
  uniqueLabel,
  type CapturedScreen,
  type JudgeRunInput,
  type JudgeRunResult,
} from "./judge-run"
