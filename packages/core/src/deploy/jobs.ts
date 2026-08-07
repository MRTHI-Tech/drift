/**
 * Starting the worker.
 *
 * The worker is a Cloud Run job, not a service, so nothing can call it over
 * HTTP. It is started by asking the Cloud Run Admin API to run it, with the
 * command line for this particular execution passed as a container override.
 * That is how both event-driven paths work and they differ only in the trigger
 * they pass: Cloud Scheduler posts this same request on an interval per
 * project, and the dashboard's push endpoint posts it when a watched repo
 * redeploys. The `runs` document therefore says `scheduled` or `deploy` because
 * the command line said so, rather than because anything guessed.
 *
 * The access token and the region both come from the metadata server, which
 * every Cloud Run container has. That keeps two more values out of the
 * environment and out of the deploy instructions, and means a service moved to
 * another region needs no redeploy to keep working.
 */
import { DEPLOYMENT } from "../constants"
import type { RunTrigger } from "../types"

const METADATA_ROOT = "http://metadata.google.internal/computeMetadata/v1"
const METADATA_HEADERS = { "Metadata-Flavor": "Google" }

/** What one execution of the worker job should do. */
export interface WorkerJobRequest {
  googleCloudProject: string
  region: string
  projectId: string
  trigger: RunTrigger
  /** Limit the execution to these routes. Empty renders every declared route. */
  routes?: readonly string[]
}

/** Where the Cloud Run Admin API takes a request to run a job. */
export function jobRunUrl(googleCloudProject: string, region: string): string {
  return (
    `https://run.googleapis.com/v2/projects/${googleCloudProject}` +
    `/locations/${region}/jobs/${DEPLOYMENT.workerJob}:run`
  )
}

/**
 * The worker's command line for one execution.
 *
 * These are the container's args, so they replace the job's default args and
 * leave its entrypoint alone. The job as `deploy.md` creates it has no default
 * args at all, which is deliberate: an execution that arrives without an
 * override should fail with the CLI's usage message rather than quietly render
 * whichever project happened to be baked into the image.
 */
export function workerArgs(request: WorkerJobRequest): string[] {
  const args = ["run", "--project", request.projectId, "--trigger", request.trigger]
  for (const route of request.routes ?? []) args.push("--route", route)
  return args
}

/** The body of a run request, as the Cloud Run Admin API takes it. */
export function jobRunBody(request: WorkerJobRequest): {
  overrides: { containerOverrides: Array<{ args: string[] }> }
} {
  return { overrides: { containerOverrides: [{ args: workerArgs(request) }] } }
}

/** One started execution, named so a log query can follow it. */
export interface StartedExecution {
  /** Full resource name, `projects/.../executions/drift-worker-abcde`. */
  name: string
  /** Last segment of the name, which is what the console lists. */
  executionId: string
}

/**
 * Runs the worker job once. Throws on anything the API refuses, because the
 * caller has to decide whether that is worth retrying and only the caller
 * knows.
 */
export async function runWorkerJob(request: WorkerJobRequest): Promise<StartedExecution> {
  const token = await accessToken()
  const response = await fetch(jobRunUrl(request.googleCloudProject, request.region), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(jobRunBody(request)),
  })

  if (!response.ok) {
    throw new Error(
      `Cloud Run refused to start ${DEPLOYMENT.workerJob}: ${response.status} ${await responseText(response)}`,
    )
  }

  const body: unknown = await response.json()
  const name = executionName(body)
  return { name, executionId: name.slice(name.lastIndexOf("/") + 1) }
}

/**
 * The region this container runs in. The metadata server answers with
 * `projects/123456/regions/us-central1`; only the last segment is a region.
 */
export async function currentRegion(): Promise<string> {
  const value = await metadata("instance/region")
  const region = value.slice(value.lastIndexOf("/") + 1).trim()
  if (!region) {
    throw new Error(`The metadata server gave no region. It said ${value}.`)
  }
  return region
}

/** An access token for the container's own service account. */
async function accessToken(): Promise<string> {
  const body: unknown = JSON.parse(await metadata("instance/service-accounts/default/token"))
  const token = (body as { access_token?: unknown }).access_token
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("The metadata server gave no access token.")
  }
  return token
}

async function metadata(path: string): Promise<string> {
  const response = await fetch(`${METADATA_ROOT}/${path}`, { headers: METADATA_HEADERS })
  if (!response.ok) {
    throw new Error(
      `The metadata server answered ${response.status} for ${path}. ` +
        "This only runs on Google Cloud.",
    )
  }
  return response.text()
}

/** The execution's resource name, or a clear error about a shape that changed. */
function executionName(body: unknown): string {
  const metadataField = (body as { metadata?: unknown }).metadata
  const name =
    typeof metadataField === "object" && metadataField !== null
      ? (metadataField as { name?: unknown }).name
      : undefined

  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Cloud Run started the job but named no execution.")
  }
  return name
}

async function responseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500)
  } catch {
    return "(no body)"
  }
}
