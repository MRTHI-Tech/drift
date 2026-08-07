/**
 * The event-driven half of a deployed Drift.
 *
 * A run starts one of three ways and this directory holds two of them. Cloud
 * Scheduler starts one per project on an interval, and a watched repo that has
 * just redeployed publishes to a Pub/Sub topic whose push subscription reaches
 * the dashboard, which starts one carrying the `deploy` trigger. Both end at
 * the same place: one execution of the Cloud Run job that is `apps/worker`,
 * with the project and the trigger on its command line.
 *
 * Nothing in here calls a model, writes to Firestore, or decides anything about
 * a finding. It decides which project redeployed and starts the worker.
 */
export {
  bearerToken,
  checkClaims,
  decodeJwt,
  pushAudience,
  pushServiceAccountEmail,
  verifyPushToken,
  type ClaimCheck,
  type DecodedJwt,
  type ExpectedClaims,
  type IdTokenClaims,
  type Verification,
} from "./identity"

export {
  currentRegion,
  jobRunBody,
  jobRunUrl,
  runWorkerJob,
  workerArgs,
  type StartedExecution,
  type WorkerJobRequest,
} from "./jobs"

export {
  deployEventSchema,
  parseDeployEvent,
  parsePushEnvelope,
  pushEnvelopeSchema,
  type DeployEvent,
  type MessageProblem,
  type Parsed,
  type PushEnvelope,
} from "./message"
