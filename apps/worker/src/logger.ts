/**
 * Structured JSON logs, one object per line, because Cloud Run picks those up
 * natively (AGENTS.md section 7). Every phase transition of a run goes through
 * here carrying its runId and projectId.
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
