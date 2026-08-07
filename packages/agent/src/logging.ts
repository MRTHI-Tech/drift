/**
 * The slice of the worker's logger the judgment phase needs. Declared here as
 * an interface rather than imported, so `@drift/agent` does not depend on the
 * worker; the worker's logger satisfies it structurally and every line the
 * judgment phase writes therefore carries the run's `runId` and `projectId`
 * (AGENTS.md section 7).
 */
export interface AgentLogger {
  log(phase: string, fields?: Record<string, unknown>): void
  error(phase: string, fields?: Record<string, unknown>): void
}

/** A logger that writes nothing, for callers that do not want the lines. */
export const silentLogger: AgentLogger = {
  log() {},
  error() {},
}

/** The message of anything thrown, without leaking a stack into a log field. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
