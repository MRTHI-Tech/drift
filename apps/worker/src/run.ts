/**
 * One run: load the project, read its config and its design tokens off GitHub,
 * render every declared target, sign and diff what came back, persist it, judge
 * it against its siblings, and write the `runs` document. A failed target is
 * recorded and the run carries on; the run document is written even when
 * everything failed (AGENTS.md section 7).
 *
 * Render, extract, sign, diff, and persist never call a model. Judge does, and
 * only after those have finished: it reads what they wrote and adds to it. A
 * model that is unavailable costs the run its pattern findings and nothing
 * else (AGENTS.md section 4).
 */
import { fixerFor, judgeRun, type CapturedScreen } from "@drift/agent"
import {
  actuationCandidates,
  buildSignature,
  claimedFixes,
  countTokens,
  githubClientFor,
  createRepositories,
  diffScreenTokens,
  fetchDriftConfig,
  fetchTokenDefinitions,
  openAutonomousPullRequests,
  persistTokenFindings,
  tokenDedupeKey,
  verifyFixes,
  uploadScreenshot,
  type AutonomousRunResult,
  type VerificationResult,
  type DriftConfig,
  type Finding,
  type Project,
  type Repositories,
  type Run,
  type RunStatus,
  type RunTrigger,
  type TokenDriftCandidate,
  type TokenSet,
} from "@drift/core"
import type { Browser } from "playwright"

import { captureTarget, launchBrowser, renderSettings, type RenderSettings } from "./capture"
import { capExtraction } from "./extract"
import { createLogger, errorMessage, type Logger } from "./logger"
import { screenshotObjectPath } from "./screenshot-path"
import { buildTargets, describeTarget, filterTargets, type RenderTarget } from "./targets"

/** Run id used while dry running, when no `runs` document exists. */
export const DRY_RUN_ID = "dry-run"

export interface RunOptions {
  projectId: string
  /** Limit the run to these routes. Empty renders every declared route. */
  routes?: string[]
  /** Render and extract, write nothing. */
  dryRun?: boolean
  trigger?: RunTrigger
  /** Injectable for tests. Defaults to the real Firestore repositories. */
  repositories?: Repositories
  logger?: Logger
}

/** One target that did not render. The run keeps going past it. */
export interface TargetFailure {
  target: RenderTarget
  message: string
}

export interface RunSummary {
  runId: string
  projectId: string
  status: RunStatus
  routesChecked: number
  screenIds: string[]
  /** Findings this run raised. A candidate an existing finding covers is not one. */
  findingIds: string[]
  failures: TargetFailure[]
  /** What the autonomy boundary did with this run's findings, or null on a dry run. */
  actuation: AutonomousRunResult | null
  /**
   * Whether the fixes somebody accepted actually took, or null on a dry run
   * and on a project where nobody has accepted one yet.
   */
  verification: VerificationResult | null
}

/** The authenticated GitHub client, without reaching past `@drift/core` for its type. */
type GitHubClient = ReturnType<typeof githubClientFor>

export async function runProject(options: RunOptions): Promise<RunSummary> {
  const dryRun = options.dryRun ?? false
  const repositories = options.repositories ?? createRepositories()
  const projectLogger = (options.logger ?? createLogger()).child({ projectId: options.projectId })

  projectLogger.log("run.loading_project", { dryRun })
  const project = await repositories.projects.get(options.projectId)
  if (!project) {
    // No run document: a run has to belong to a project that exists.
    throw new Error(`There is no project ${options.projectId}. Nothing was written.`)
  }

  const startedAt = new Date()
  const run = dryRun ? null : await repositories.runs.create(startingRun(project.id, options, startedAt))
  const runId = run?.id ?? DRY_RUN_ID
  const logger = projectLogger.child({ runId })
  logger.log("run.start", {
    trigger: options.trigger ?? "manual",
    repo: project.repo,
    previewUrl: project.previewUrl,
    dryRun,
    // Cloud Run sets this on every execution of a job. Logging it once is what
    // connects a runId in Firestore to an execution on the job's console page,
    // in both directions. Null on a laptop.
    execution: process.env.CLOUD_RUN_EXECUTION ?? null,
  })

  try {
    const github = githubClientFor(project.installationId)
    const config = await loadConfig(github, project, logger)
    const settings = renderSettings(project.previewUrl, config.authCookieName)
    const tokens = await loadTokens(github, project, config, logger)

    const targets = filterTargets(buildTargets(config), options.routes ?? [])
    if (targets.length === 0) {
      throw new Error("No targets to render. Check --route against the config's routes.")
    }
    logger.log("render.planned", { targets: targets.length, routes: config.routes.length })

    const {
      screenIds,
      findingIds,
      tokenFindings,
      distances,
      captured,
      knownFindings,
      failures,
      observedKeys,
      renderedRoutes,
    } = await renderAll(
      {
        targets,
        settings,
        project,
        runId,
        dryRun,
        tokens,
        repositories,
        logger,
      },
    )

    // Verification, before judgment, because it is about what the render just
    // saw and nothing a model says can change the answer.
    const verification = dryRun
      ? null
      : await verifyRun({ project, repositories, observedKeys, renderedRoutes, logger })

    // Judgment runs once, over everything the run captured, because an
    // archetype and its conventions are a property of the set rather than of
    // any one screen. Skipped on a dry run: it writes.
    if (!dryRun && captured.length > 0) {
      const judged = await judgeRun({
        projectId: project.id,
        runId,
        screens: captured,
        repositories,
        logger,
      })
      findingIds.push(...judged.findingIds)
    }

    // Actuation is last, after every finding this run could raise is written.
    // It is additive in the same way judgment is: a pull request that cannot be
    // opened costs a finding its patch and costs the run nothing.
    const actuation = dryRun
      ? null
      : await actuateRun({ github, project, tokenFindings, distances, repositories, logger })

    const outcome = summarizeRun(targets, failures, findingIds.length)
    const summary: RunSummary = {
      runId,
      projectId: project.id,
      status: outcome.status,
      routesChecked: outcome.routesChecked,
      screenIds,
      findingIds,
      failures,
      actuation,
      verification,
    }

    if (run) {
      await repositories.runs.update(run.id, {
        finishedAt: new Date(),
        routesChecked: outcome.routesChecked,
        status: outcome.status,
        findingIds,
        knownFindings,
        error: outcome.error,
      })
      await touchProject(repositories, project.id, startedAt, logger)
    }

    logger.log("run.finish", {
      status: outcome.status,
      routesChecked: outcome.routesChecked,
      screensWritten: screenIds.length,
      findingsRaised: findingIds.length,
      knownFindings,
      pullRequestsOpened: actuation?.opened.length ?? 0,
      findingsWaiting: actuation?.waiting.length ?? 0,
      fixesConfirmed: verification?.fixed.length ?? 0,
      // Not "reopened": most of these were never closed. A pull request was
      // opened for each and the value it was meant to change is still there.
      fixesStillDrifting: verification?.unfixed.length ?? 0,
      failed: failures.length,
      durationMs: Date.now() - startedAt.getTime(),
    })

    return summary
  } catch (error) {
    const message = errorMessage(error)
    if (run) {
      await repositories.runs
        .update(run.id, { finishedAt: new Date(), status: "error", error: message })
        .catch((cause: unknown) => {
          logger.error("run.finalise_failed", { message: errorMessage(cause) })
        })
    }
    logger.error("run.error", { message })
    throw error
  }
}

interface RenderAllInput {
  targets: RenderTarget[]
  settings: RenderSettings
  project: Project
  runId: string
  dryRun: boolean
  /** The watched repo's tokens, or null when it declares none Drift could read. */
  tokens: TokenSet | null
  repositories: Repositories
  logger: Logger
}

/** What one target left behind. */
interface TargetResult {
  screenId: string
  /** Token findings this target raised, as written. */
  findings: Finding[]
  /**
   * The dedupe key of every candidate the diff produced, written or not.
   * A candidate suppressed because a resolved finding already carries its key
   * is exactly what verification is looking for.
   */
  observedKeys: string[]
  /**
   * How far each of those findings sat from the token it missed, by finding id.
   * Only the diff that raised it knows this, and the autonomy boundary needs it
   * later, so it is carried rather than recomputed.
   */
  distances: Map<string, number>
  /**
   * The stored screen and the image of it, held for the judgment phase. Held in
   * memory rather than re-read from Cloud Storage: the run has just written
   * both and judging happens seconds later.
   */
  captured: CapturedScreen
  /** Candidates an existing finding already covered, so nothing was written. */
  alreadyKnown: number
}

async function renderAll(input: RenderAllInput): Promise<{
  screenIds: string[]
  findingIds: string[]
  tokenFindings: Finding[]
  distances: Map<string, number>
  captured: CapturedScreen[]
  knownFindings: number
  failures: TargetFailure[]
  /** Every dedupe key this render raised, whether or not it was written. */
  observedKeys: Set<string>
  /** Routes that actually rendered, so a missing one is not read as a pass. */
  renderedRoutes: Set<string>
}> {
  const browser = await launchBrowser()
  input.logger.log("render.browser_ready", { chromium: browser.version() })

  const screenIds: string[] = []
  const findingIds: string[] = []
  const tokenFindings: Finding[] = []
  const distances = new Map<string, number>()
  const captured: CapturedScreen[] = []
  const observedKeys = new Set<string>()
  const renderedRoutes = new Set<string>()
  let knownFindings = 0
  try {
    const failures = await captureAll(
      input.targets,
      async (target) => {
        const result = await renderOne(browser, target, input)
        if (!result) return
        screenIds.push(result.screenId)
        findingIds.push(...result.findings.map((finding) => finding.id))
        tokenFindings.push(...result.findings)
        for (const [findingId, distance] of result.distances) distances.set(findingId, distance)
        captured.push(result.captured)
        knownFindings += result.alreadyKnown
        renderedRoutes.add(target.route)
        for (const key of result.observedKeys) observedKeys.add(key)
      },
      input.logger,
    )
    return {
      screenIds,
      findingIds,
      tokenFindings,
      distances,
      captured,
      knownFindings,
      failures,
      observedKeys,
      renderedRoutes,
    }
  } finally {
    await browser.close()
    input.logger.log("render.browser_closed")
  }
}

/**
 * Runs every target in order and isolates their errors: one target throwing is
 * recorded and the rest still render. Sequential on purpose, so a run puts a
 * predictable load on the watched preview.
 */
export async function captureAll(
  targets: RenderTarget[],
  render: (target: RenderTarget) => Promise<void>,
  logger: Logger,
): Promise<TargetFailure[]> {
  const failures: TargetFailure[] = []

  for (const target of targets) {
    try {
      await render(target)
    } catch (error) {
      const message = errorMessage(error)
      failures.push({ target, message })
      logger.error("render.target_failed", {
        route: target.route,
        viewport: target.viewport,
        message,
      })
    }
  }

  return failures
}

/**
 * Renders one target, signs it, diffs it against the tokens, and writes the
 * screen and whatever findings the diff raised. Returns null on a dry run. No
 * model is called here; judgment waits until every target is in.
 */
async function renderOne(
  browser: Browser,
  target: RenderTarget,
  input: RenderAllInput,
): Promise<TargetResult | null> {
  const logger = input.logger.child({ route: target.route, viewport: target.viewport })
  const startedAt = Date.now()
  logger.log("render.target_start")

  const capture = await captureTarget(browser, target, input.settings, logger)
  const extraction = capExtraction(capture.extraction)

  const signature = buildSignature({
    route: target.route,
    viewport: target.viewport,
    computedStyles: extraction.computedStyles,
    text: extraction.text,
  })
  logger.log("sign.done", {
    interactive: signature.interactive.length,
    typeSteps: signature.typeHierarchy.length,
    sections: signature.sectionCount,
    labelCase: signature.copy.labels.dominantCase,
  })

  const candidates = input.tokens ? diffScreenTokens(extraction.computedStyles, input.tokens) : []
  logger.log("diff.done", { candidates: candidates.length, tokensLoaded: input.tokens !== null })

  if (input.dryRun) {
    logger.log("persist.skipped", {
      dryRun: true,
      elements: extraction.elementCount,
      candidates: candidates.length,
      durationMs: Date.now() - startedAt,
    })
    return null
  }

  const objectPath = screenshotObjectPath({
    projectId: input.project.id,
    runId: input.runId,
    route: target.route,
    viewport: target.viewport,
  })
  const screenshotPath = await uploadScreenshot(objectPath, capture.screenshot)
  logger.log("persist.screenshot_uploaded", { screenshotPath })

  const screen = await input.repositories.screens.create({
    projectId: input.project.id,
    route: target.route,
    viewport: target.viewport,
    runId: input.runId,
    screenshotPath,
    computedStyles: extraction.computedStyles,
    text: extraction.text,
    signature,
    // Both are filled in by later phases.
    archetypeId: null,
    embedding: null,
    capturedAt: new Date(),
  })

  logger.log("persist.screen_written", {
    screenId: screen.id,
    elements: extraction.elementCount,
    truncated: extraction.truncated,
    durationMs: Date.now() - startedAt,
  })

  const { created, alreadyKnown } = await persistTokenFindings({
    findings: input.repositories.findings,
    projectId: input.project.id,
    runId: input.runId,
    screenId: screen.id,
    route: target.route,
    candidates,
  })

  logger.log("persist.findings_written", {
    screenId: screen.id,
    created: created.length,
    // Candidates an open, resolved, or dismissed finding already covers.
    alreadyKnown,
  })

  return {
    screenId: screen.id,
    findings: created,
    distances: nearestTokenDistances(input.project.id, target.route, candidates, created),
    captured: { screen, screenshot: capture.screenshot },
    alreadyKnown,
    // Every candidate, not only the ones written. A candidate suppressed
    // because a resolved finding already carries its key is exactly the case
    // verification exists to notice.
    observedKeys: candidates.map((candidate) =>
      tokenDedupeKey(input.project.id, target.route, candidate),
    ),
  }
}

/**
 * How far each written finding sat from the token it missed, by finding id.
 *
 * The candidates and the findings are matched on the dedupe key rather than by
 * position, because `persistTokenFindings` writes only the candidates no
 * existing finding already covers and the two lists therefore do not line up.
 */
function nearestTokenDistances(
  projectId: string,
  route: string,
  candidates: readonly TokenDriftCandidate[],
  created: readonly Finding[],
): Map<string, number> {
  const byKey = new Map(
    candidates.flatMap((candidate) =>
      candidate.nearestToken
        ? [[tokenDedupeKey(projectId, route, candidate), candidate.nearestToken.distance] as const]
        : [],
    ),
  )

  const distances = new Map<string, number>()
  for (const finding of created) {
    const distance = byKey.get(finding.dedupeKey)
    if (distance !== undefined) distances.set(finding.id, distance)
  }
  return distances
}

interface ActuateRunInput {
  github: GitHubClient
  project: Project
  tokenFindings: readonly Finding[]
  distances: ReadonlyMap<string, number>
  repositories: Repositories
  logger: Logger
}

interface VerifyRunInput {
  project: Project
  repositories: Repositories
  observedKeys: Set<string>
  renderedRoutes: Set<string>
  logger: Logger
}

/**
 * Asking whether the fixes somebody accepted actually took.
 *
 * A finding resolved as `conform` says a person agreed the screen should
 * change. Nothing until now said the screen changed, and nothing could: a
 * resolved finding suppresses its own recurrence, because `createIfNew`
 * refuses any dedupe key already on file whatever status it carries. So the
 * drift could return, be measured, and be silently discarded as already known.
 *
 * A fix that did not take reopens. That is the whole point of it: the finding
 * is true again, and true findings are open. The resolution stays on file,
 * because a `resolutions` document is append-only and a person's decision is
 * not undone by the product ignoring it.
 *
 * Never throws. Verification is an extra thing a run knows, not a thing a run
 * depends on.
 */
async function verifyRun(input: VerifyRunInput): Promise<VerificationResult | null> {
  try {
    const all = await input.repositories.findings.listByProject(input.project.id, 500)
    const claimed = claimedFixes(all)
    if (claimed.length === 0) return null

    const summaries = await input.repositories.screens.listSummaries(input.project.id)
    const result = verifyFixes({
      claimed,
      observed: input.observedKeys,
      routes: input.renderedRoutes,
      routeOf: new Map(summaries.map((screen) => [screen.id, screen.route])),
    })

    // A finding whose value is gone is not true any more, so it does not stay
    // open. The status is set directly rather than through `resolveFinding`,
    // because that path writes a `resolutions` document and opens a pull
    // request, and neither belongs here: nobody decided anything, and the fix
    // this is confirming is the one already merged.
    for (const finding of result.fixed) {
      if (finding.status === "open") {
        await input.repositories.findings.setStatus(finding.id, "resolved_conform")
      }
      await input.repositories.findings.update(finding.id, { verifiedAt: new Date() })
    }

    // Still on the screen. A finding somebody closed reopens; one that was
    // never closed simply stays open, and the log is what says the pull
    // request it carries did not do the job.
    for (const finding of result.unfixed) {
      if (finding.status !== "open") {
        await input.repositories.findings.setStatus(finding.id, "open")
      }
    }

    input.logger.log("verify.done", {
      claimed: claimed.length,
      confirmed: result.fixed.map((finding) => ({
        findingId: finding.id,
        pullRequest: finding.prNumber,
      })),
      // The useful line. A pull request was opened for each of these and the
      // value it was meant to change is still being rendered.
      stillDrifting: result.unfixed.map((finding) => ({
        findingId: finding.id,
        pullRequest: finding.prNumber,
        value: finding.evidence.observedValue,
      })),
      unchecked: result.unchecked.length,
    })

    return result
  } catch (error) {
    input.logger.error("verify.error", { message: errorMessage(error) })
    return null
  }
}

/**
 * The autonomous class, asked once per run over everything it raised.
 *
 * Which findings may go out unprompted is `isAutonomousFix`'s decision and only
 * its decision; this only hands it the findings and the distances the diff
 * measured. Never throws: the findings are already written and already waiting
 * for a person, which is where every finding starts.
 */
async function actuateRun(input: ActuateRunInput): Promise<AutonomousRunResult | null> {
  const candidates = actuationCandidates(input.tokenFindings, input.distances)
  if (candidates.length === 0) return null

  try {
    return await openAutonomousPullRequests({
      octokit: input.github,
      project: input.project,
      candidates,
      repositories: input.repositories,
      logger: input.logger,
      // Asked only for a finding the mechanical patcher would not touch
      // (AGENTS.md section 10a). The worker is where the Fixer is joined to
      // the run, because it is the only package that depends on both.
      proposeFix: fixerFor(input.logger),
    })
  } catch (error) {
    input.logger.error("actuate.error", { message: errorMessage(error) })
    return null
  }
}

/**
 * Where a run stands the moment it is created. It reads as an error until it
 * finishes, so a process that is killed mid-run leaves an honest document
 * behind rather than one that claims to be clean.
 */
function startingRun(
  projectId: string,
  options: RunOptions,
  startedAt: Date,
): Omit<Run, "id"> {
  return {
    projectId,
    trigger: options.trigger ?? "manual",
    startedAt,
    finishedAt: null,
    routesChecked: 0,
    status: "error",
    findingIds: [],
    // Nobody has counted yet. Filled in when the run finishes.
    knownFindings: null,
    error: "The run did not finish.",
  }
}

/**
 * A run is an error when any target did not render, findings when it raised
 * one, and clean otherwise. A run whose candidates were all covered by
 * findings that already exist is clean: it found nothing new to say. What it
 * did find is counted on the run document as `knownFindings` rather than
 * folded into the status, because a run that suppressed twenty sightings and
 * a run that saw nothing are both clean and are not the same thing. Partial
 * results stay persisted whatever the status.
 *
 * A route counts as checked only when every viewport of it rendered: half a
 * route is not a route a later phase can compare.
 */
export function summarizeRun(
  targets: RenderTarget[],
  failures: TargetFailure[],
  findingsRaised = 0,
): { status: RunStatus; routesChecked: number; error: string | null } {
  const failedRoutes = new Set(failures.map((failure) => failure.target.route))
  const routes = new Set(targets.map((target) => target.route))
  const checked = [...routes].filter((route) => !failedRoutes.has(route))

  const status: RunStatus =
    failures.length > 0 ? "error" : findingsRaised > 0 ? "findings" : "clean"

  return {
    status,
    routesChecked: checked.length,
    error: failures.length === 0 ? null : describeFailures(targets.length, failures),
  }
}

/** One line a person can act on, short enough to sit in a document. */
export function describeFailures(total: number, failures: TargetFailure[]): string {
  const detail = failures
    .map((failure) => `${describeTarget(failure.target)}: ${failure.message}`)
    .join("; ")
  const head = `${failures.length} of ${total} targets failed. `
  return truncate(head + detail, 1000)
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

async function loadConfig(
  github: GitHubClient,
  project: Project,
  logger: Logger,
): Promise<DriftConfig> {
  logger.log("config.fetching", {
    repo: project.repo,
    path: project.configPath,
    ref: project.defaultBranch,
  })

  const config = await fetchDriftConfig(github, project)

  logger.log("config.loaded", {
    routes: config.routes.length,
    viewports: config.viewports,
    authCookie: config.authCookieName !== null,
    seedData: config.seedData,
    tokenDefinitions: config.tokenDefinitionsPath,
  })
  return config
}

/**
 * The watched repo's design tokens, from the path its config declares. A path
 * that is missing or unreadable costs the run its token findings and nothing
 * else: the screens are still worth rendering and signing, and a loud line in
 * the log is how the person fixes the path.
 */
async function loadTokens(
  github: GitHubClient,
  project: Project,
  config: DriftConfig,
  logger: Logger,
): Promise<TokenSet | null> {
  if (!config.tokenDefinitionsPath) {
    logger.log("tokens.not_declared")
    return null
  }

  try {
    const definitions = await fetchTokenDefinitions(github, project, config.tokenDefinitionsPath)
    if (!definitions) {
      logger.error("tokens.missing", {
        path: config.tokenDefinitionsPath,
        ref: project.defaultBranch,
      })
      return null
    }

    const total = countTokens(definitions.tokens)
    logger.log("tokens.loaded", {
      path: definitions.path,
      tokens: total,
      colors: definitions.tokens.color.length,
      spacing: definitions.tokens.spacing.length,
      fontSizes: definitions.tokens.fontSize.length,
    })
    // A file Drift could read but found nothing in usually means the tokens
    // are built somewhere else, so say it rather than diffing against nothing.
    if (total === 0) logger.error("tokens.empty", { path: definitions.path })

    return definitions.tokens
  } catch (error) {
    logger.error("tokens.unreadable", {
      path: config.tokenDefinitionsPath,
      message: errorMessage(error),
    })
    return null
  }
}

/** Keeps the project's `lastRunAt` fresh. Never worth failing a run over. */
async function touchProject(
  repositories: Repositories,
  projectId: string,
  lastRunAt: Date,
  logger: Logger,
): Promise<void> {
  try {
    await repositories.projects.update(projectId, { lastRunAt })
  } catch (error) {
    logger.error("persist.project_touch_failed", { message: errorMessage(error) })
  }
}
