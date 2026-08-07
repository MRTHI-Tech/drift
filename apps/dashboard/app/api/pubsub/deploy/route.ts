/**
 * The deploy webhook: a watched repo redeployed its preview, so render it.
 *
 * A Pub/Sub push subscription posts here. This is the only route in the
 * dashboard that is not behind the session cookie, because a push subscription
 * cannot carry one; what stands in front of it instead is the OIDC token Google
 * signs every push with, checked in `@drift/core` against this endpoint's own
 * URL and against the one service account `deploy.md` creates. `proxy.ts` lets
 * the path through for the same reason it lets `/api/auth/session` through: the
 * gate is here, not there.
 *
 * The work is small on purpose. The dashboard does not render anything: it
 * finds which project owns the repo that redeployed and starts one execution of
 * the worker job with `--trigger deploy`, which is the same job Cloud Scheduler
 * starts on an interval. Rendering, judging and actuating are the worker's, and
 * the run that appears in the dashboard a few minutes later is one nobody
 * touched.
 *
 * What it answers matters as much as what it does, because a non-2xx tells
 * Pub/Sub to deliver the message again. A message this endpoint will never be
 * able to act on is acknowledged and logged; only a failure that could go
 * differently next time is a 500.
 */

import {
  bearerToken,
  createRepositories,
  createLogger,
  currentRegion,
  errorMessage,
  parseDeployEvent,
  parsePushEnvelope,
  pushAudience,
  pushServiceAccountEmail,
  runWorkerJob,
  verifyPushToken,
} from "@drift/core"

// firebase-admin and the metadata server both need Node, not the edge runtime.
export const runtime = "nodejs"

export async function POST(request: Request): Promise<Response> {
  const logger = createLogger({ trigger: "deploy" })

  const googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT
  if (!googleCloudProject) {
    logger.error("deploy.misconfigured", { message: "GOOGLE_CLOUD_PROJECT is not set." })
    return retry("This dashboard is not configured to start runs.")
  }

  const audience = pushAudience(request.url, request.headers.get("x-forwarded-host"))
  const token = bearerToken(request.headers.get("authorization"))
  if (!token) {
    logger.error("deploy.unauthenticated", { audience })
    return Response.json({ error: "This endpoint takes signed pushes only." }, { status: 401 })
  }

  let verified
  try {
    verified = await verifyPushToken(token, {
      audience,
      email: pushServiceAccountEmail(googleCloudProject),
      now: Math.floor(Date.now() / 1000),
    })
  } catch (error) {
    // Google's key set was unreachable. The push is probably fine; ask for it
    // again rather than rejecting a caller for a failure that is not theirs.
    logger.error("deploy.keys_unreadable", { message: errorMessage(error) })
    return retry("Could not check who sent that.")
  }

  if (!verified.ok) {
    logger.error("deploy.rejected", { reason: verified.reason, audience })
    return Response.json({ error: "That push was not accepted." }, { status: 403 })
  }

  // Acknowledged from here on unless starting the job fails: everything below
  // is a property of the message, and redelivering it changes none of them.
  const envelope = parsePushEnvelope(await readBody(request))
  if (!envelope.value) {
    logger.error("deploy.unreadable", { reason: envelope.problem.reason })
    return acknowledged(envelope.problem.reason)
  }

  const messageId = envelope.value.message.messageId ?? null
  const event = parseDeployEvent(envelope.value)
  if (!event.value) {
    logger.error("deploy.unreadable", { messageId, reason: event.problem.reason })
    return acknowledged(event.problem.reason)
  }

  const { repo, commit, ref } = event.value
  logger.log("deploy.received", { messageId, repo, commit: commit ?? null, ref: ref ?? null })

  const project = await createRepositories().projects.findByRepo(repo)
  if (!project) {
    // Somebody wired a repo Drift does not watch. Retrying will not change it.
    logger.error("deploy.unwatched_repo", { messageId, repo })
    return acknowledged(`No project watches ${repo}.`)
  }

  const projectLogger = logger.child({ projectId: project.id })

  try {
    const started = await runWorkerJob({
      googleCloudProject,
      region: await currentRegion(),
      projectId: project.id,
      trigger: "deploy",
    })
    projectLogger.log("deploy.run_started", {
      messageId,
      repo,
      commit: commit ?? null,
      execution: started.executionId,
    })
    return Response.json({ started: started.executionId })
  } catch (error) {
    // Cloud Run refused, or the metadata server did. Both can go differently in
    // a minute, so let Pub/Sub bring the message back.
    projectLogger.error("deploy.run_failed", { messageId, repo, message: errorMessage(error) })
    return retry("Could not start the run.")
  }
}

/** Read once, as text, so a body that is not JSON fails in one place. */
async function readBody(request: Request): Promise<unknown> {
  try {
    return JSON.parse(await request.text())
  } catch {
    return null
  }
}

/**
 * Take the message off the queue. The reason is in the log and in the body; a
 * 2xx is what stops Pub/Sub redelivering something that will fail identically.
 */
function acknowledged(reason: string): Response {
  return Response.json({ started: null, reason }, { status: 200 })
}

/** Ask Pub/Sub to deliver it again. */
function retry(error: string): Response {
  return Response.json({ error }, { status: 500 })
}
