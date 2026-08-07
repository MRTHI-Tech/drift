/**
 * The slice of the worker's logger actuation needs, declared here rather than
 * imported so `@drift/core` does not depend on the worker. The worker's logger
 * satisfies it structurally, so every line an actuation writes carries the
 * run's `runId` and `projectId` (AGENTS.md section 7).
 */
export interface ActuationLogger {
  log(phase: string, fields?: Record<string, unknown>): void
  error(phase: string, fields?: Record<string, unknown>): void
}

/** A logger that writes nothing, for callers that do not want the lines. */
export const silentActuationLogger: ActuationLogger = {
  log() {},
  error() {},
}

/** The message of anything thrown, without leaking a stack into a log field. */
export function actuationError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
