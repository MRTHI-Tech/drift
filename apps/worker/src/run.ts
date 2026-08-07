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
import { judgeRun, type CapturedScreen } from "@drift/agent"
import {
  buildSignature,
  countTokens,
  createGitHubClient,
  createRepositories,
  diffScreenTokens,
  fetchDriftConfig,
  fetchTokenDefinitions,
  persistTokenFindings,
  uploadScreenshot,
  type DriftConfig,
  type Project,
  type Repositories,
  type Run,
  type RunStatus,
  type RunTrigger,
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
}

/** The authenticated GitHub client, without reaching past `@drift/core` for its type. */
type GitHubClient = ReturnType<typeof createGitHubClient>

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
  })

  try {
    const github = createGitHubClient()
    const config = await loadConfig(github, project, logger)
    const settings = renderSettings(project.previewUrl, config.authCookieName)
    const tokens = await loadTokens(github, project, config, logger)

    const targets = filterTargets(buildTargets(config), options.routes ?? [])
    if (targets.length === 0) {
      throw new Error("No targets to render. Check --route against the config's routes.")
    }
    logger.log("render.planned", { targets: targets.length, routes: config.routes.length })

    const { screenIds, findingIds, captured, failures } = await renderAll({
      targets,
      settings,
      project,
      runId,
      dryRun,
      tokens,
      repositories,
      logger,
    })

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

    const outcome = summarizeRun(targets, failures, findingIds.length)
    const summary: RunSummary = {
      runId,
      projectId: project.id,
      status: outcome.status,
      routesChecked: outcome.routesChecked,
      screenIds,
      findingIds,
      failures,
    }

    if (run) {
      await repositories.runs.update(run.id, {
        finishedAt: new Date(),
        routesChecked: outcome.routesChecked,
        status: outcome.status,
        findingIds,
        error: outcome.error,
      })
      await touchProject(repositories, project.id, startedAt, logger)
    }

    logger.log("run.finish", {
      status: outcome.status,
      routesChecked: outcome.routesChecked,
      screensWritten: screenIds.length,
      findingsRaised: findingIds.length,
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
  findingIds: string[]
  /**
   * The stored screen and the image of it, held for the judgment phase. Held in
   * memory rather than re-read from Cloud Storage: the run has just written
   * both and judging happens seconds later.
   */
  captured: CapturedScreen
}

async function renderAll(input: RenderAllInput): Promise<{
  screenIds: string[]
  findingIds: string[]
  captured: CapturedScreen[]
  failures: TargetFailure[]
}> {
  const browser = await launchBrowser()
  input.logger.log("render.browser_ready", { chromium: browser.version() })

  const screenIds: string[] = []
  const findingIds: string[] = []
  const captured: CapturedScreen[] = []
  try {
    const failures = await captureAll(
      input.targets,
      async (target) => {
        const result = await renderOne(browser, target, input)
        if (!result) return
        screenIds.push(result.screenId)
        findingIds.push(...result.findingIds)
        captured.push(result.captured)
      },
      input.logger,
    )
    return { screenIds, findingIds, captured, failures }
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
    findingIds: created.map((finding) => finding.id),
    captured: { screen, screenshot: capture.screenshot },
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
    error: "The run did not finish.",
  }
}

/**
 * A run is an error when any target did not render, findings when it raised
 * one, and clean otherwise. A run whose candidates were all covered by
 * findings that already exist is clean: it found nothing new to say. Partial
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
