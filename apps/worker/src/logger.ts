/**
 * The worker's logger is the shared one in `@drift/core`, re-exported here so
 * every module under `src/` keeps importing it from one place. The
 * implementation moved when the dashboard started logging too: a Cloud Logging
 * query that follows one run from the job into the service only works if both
 * write the same shape. See `packages/core/src/logging.ts`.
 */
export {
  createLogger,
  errorMessage,
  type LogContext,
  type Logger,
  type LogSink,
} from "@drift/core"
