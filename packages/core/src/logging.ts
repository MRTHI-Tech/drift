/**
 * Structured JSON logs, one object per line, because Cloud Run picks those up
 * natively (AGENTS.md section 7). Every phase transition of a run goes through
 * here carrying its runId and projectId.
 *
 * One line has to be a single JSON object on stdout for Cloud Logging to lift
 * it into `jsonPayload`. `console.log` handed an object writes Node's inspect
 * form instead, which is not JSON and lands as an unqueryable text blob, so
 * everything here stringifies first. `severity` is the field Cloud Logging
 * reads off the payload to set the entry's level.
 *
 * It lives in `@drift/core` rather than in the worker because both deployed
 * processes log: the worker writes a run's phases from a Cloud Run job and the
 * dashboard writes what a deploy webhook did from a Cloud Run service, and one
 * log query across both only works if they agree on the shape.
 */

/** Fields every line of a logger carries, added to the ones the call passes. */
export type LogContext = Record<string, unknown>

export interface Logger {
  /** One phase transition. */
  log(phase: string, fields?: LogContext): void
  /** The same, at ERROR severity. */
  error(phase: string, fields?: LogContext): void
  /** A logger that adds more standing fields, for example a route. */
  child(context: LogContext): Logger
}

/** Where a logger writes. Injectable so tests read lines instead of stdout. */
export type LogSink = (line: string) => void

const writeLine: LogSink = (line) => {
  console.log(line)
}

export function createLogger(context: LogContext = {}, sink: LogSink = writeLine): Logger {
  const emit = (severity: string, phase: string, fields: LogContext): void => {
    sink(JSON.stringify({ severity, phase, ...context, ...fields }))
  }

  return {
    log(phase, fields = {}) {
      emit("INFO", phase, fields)
    },
    error(phase, fields = {}) {
      emit("ERROR", phase, fields)
    },
    child(extra) {
      return createLogger({ ...context, ...extra }, sink)
    },
  }
}

/** The message of anything thrown, without leaking a stack into a log field. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
