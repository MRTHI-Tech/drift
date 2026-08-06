/**
 * One run: load the project, read its config off GitHub, render every declared
 * target, persist what came back, and write the `runs` document. A failed
 * target is recorded and the run carries on; the run document is written even
 * when everything failed (AGENTS.md section 7).
 */
import {
  createGitHubClient,
  createRepositories,
  fetchDriftConfig,
  uploadScreenshot,
  type DriftConfig,
  type Project,
  type Repositories,
  type Run,
  type RunStatus,
  type RunTrigger,
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
  failures: TargetFailure[]
}

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
    const config = await loadConfig(project, logger)
    const settings = renderSettings(project.previewUrl, config.authCookieName)

    const targets = filterTargets(buildTargets(config), options.routes ?? [])
    if (targets.length === 0) {
      throw new Error("No targets to render. Check --route against the config's routes.")
    }
    logger.log("render.planned", { targets: targets.length, routes: config.routes.length })

    const { screenIds, failures } = await renderAll({
      targets,
      settings,
      project,
      runId,
      dryRun,
      repositories,
      logger,
    })

    const outcome = summarizeRun(targets, failures)
    const summary: RunSummary = {
      runId,
      projectId: project.id,
      status: outcome.status,
      routesChecked: outcome.routesChecked,
      screenIds,
      failures,
    }

    if (run) {
      await repositories.runs.update(run.id, {
        finishedAt: new Date(),
        routesChecked: outcome.routesChecked,
        status: outcome.status,
        error: outcome.error,
      })
      await touchProject(repositories, project.id, startedAt, logger)
    }

    logger.log("run.finish", {
      status: outcome.status,
      routesChecked: outcome.routesChecked,
      screensWritten: screenIds.length,
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
  repositories: Repositories
  logger: Logger
}

async function renderAll(
  input: RenderAllInput,
): Promise<{ screenIds: string[]; failures: TargetFailure[] }> {
  const browser = await launchBrowser()
  input.logger.log("render.browser_ready", { chromium: browser.version() })

  const screenIds: string[] = []
  try {
    const failures = await captureAll(
      input.targets,
      async (target) => {
        const screenId = await renderOne(browser, target, input)
        if (screenId) screenIds.push(screenId)
      },
      input.logger,
    )
    return { screenIds, failures }
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

/** Renders one target and writes its screen. Returns the new screen id. */
async function renderOne(
  browser: Browser,
  target: RenderTarget,
  input: RenderAllInput,
): Promise<string | null> {
  const logger = input.logger.child({ route: target.route, viewport: target.viewport })
  const startedAt = Date.now()
  logger.log("render.target_start")

  const capture = await captureTarget(browser, target, input.settings, logger)
  const extraction = capExtraction(capture.extraction)

  if (input.dryRun) {
    logger.log("persist.skipped", {
      dryRun: true,
      elements: extraction.elementCount,
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
    // Both are filled in by later phases; this one renders and extracts only.
    signature: null,
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

  return screen.id
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
 * This phase produces no findings, so a run is clean when every target
 * rendered and an error when any did not. Partial results stay persisted
 * either way.
 *
 * A route counts as checked only when every viewport of it rendered: half a
 * route is not a route a later phase can compare.
 */
export function summarizeRun(
  targets: RenderTarget[],
  failures: TargetFailure[],
): { status: RunStatus; routesChecked: number; error: string | null } {
  const failedRoutes = new Set(failures.map((failure) => failure.target.route))
  const routes = new Set(targets.map((target) => target.route))
  const checked = [...routes].filter((route) => !failedRoutes.has(route))

  return {
    status: failures.length === 0 ? "clean" : "error",
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

async function loadConfig(project: Project, logger: Logger): Promise<DriftConfig> {
  logger.log("config.fetching", {
    repo: project.repo,
    path: project.configPath,
    ref: project.defaultBranch,
  })

  const config = await fetchDriftConfig(createGitHubClient(), project)

  logger.log("config.loaded", {
    routes: config.routes.length,
    viewports: config.viewports,
    authCookie: config.authCookieName !== null,
    seedData: config.seedData,
  })
  return config
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
