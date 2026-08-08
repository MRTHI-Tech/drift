/**
 * The first run of a project that was just added.
 *
 * A project with no runs is a project that looks broken: the dashboard has
 * nothing to show on any of its three pages, and the person who just added it
 * has no way to tell the difference between "working, nothing checked yet" and
 * "wrong". So adding a project starts one run, with `trigger: manual`, because
 * a person did it.
 *
 * It is the same Cloud Run job Cloud Scheduler and the deploy webhook start, by
 * the same call, so nothing about the first run is special except what caused
 * it.
 *
 * The one thing this has to get right is not being able to. The dashboard runs
 * locally as well as on Cloud Run, and locally there is no metadata server and
 * no job to start. That is not an error and must not fail the save: the project
 * is created either way, and what comes back says how to run the worker by
 * hand. A save that rolled back because a run could not start would be the
 * tail wagging the dog.
 */

import { currentRegion, runWorkerJob } from "../deploy"
import { createLogger, errorMessage, type Logger } from "../logging"
import type { Project } from "../types"

export type FirstRunResult =
  /** The job was asked to run, and Cloud Run named an execution. */
  | { started: true; executionId: string; command: null; reason: null }
  /** Nothing was started, and this is why, and this is what to run instead. */
  | { started: false; executionId: null; command: string; reason: string }

export interface StartFirstRunInput {
  project: Project
  /** Defaults to the environment. Passed in by a test. */
  googleCloudProject?: string | undefined
  /** Set by Cloud Run on every container it starts. Absent means not deployed. */
  onCloudRun?: boolean
  logger?: Logger
}

/** What to type to render this project by hand. */
export function workerCommand(projectId: string): string {
  return `pnpm worker -- run --project ${projectId}`
}

/** Starts one execution of the worker job, or explains why it could not. */
export async function startFirstRun(input: StartFirstRunInput): Promise<FirstRunResult> {
  const {
    project,
    googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT,
    onCloudRun = Boolean(process.env.K_SERVICE),
    logger = createLogger({ projectId: project.id }),
  } = input

  const command = workerCommand(project.id)

  if (!onCloudRun) {
    const reason = "This dashboard is not running on Cloud Run, so there is no worker job to start."
    logger.log("project.first_run_unavailable", { projectId: project.id, reason })
    return { started: false, executionId: null, command, reason }
  }

  if (!googleCloudProject) {
    const reason = "GOOGLE_CLOUD_PROJECT is not set, so the worker job cannot be named."
    logger.error("project.first_run_unavailable", { projectId: project.id, reason })
    return { started: false, executionId: null, command, reason }
  }

  try {
    const started = await runWorkerJob({
      googleCloudProject,
      region: await currentRegion(),
      projectId: project.id,
      trigger: "manual",
    })

    logger.log("project.first_run_started", {
      projectId: project.id,
      execution: started.executionId,
    })

    return { started: true, executionId: started.executionId, command: null, reason: null }
  } catch (error) {
    // Cloud Run refused, or the metadata server did. The project exists and is
    // correct; only its first run did not happen.
    const reason = `Could not start the run. ${errorMessage(error)}`
    logger.error("project.first_run_failed", { projectId: project.id, reason })
    return { started: false, executionId: null, command, reason }
  }
}
