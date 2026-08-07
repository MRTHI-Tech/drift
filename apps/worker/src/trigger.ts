/**
 * How a run says it started.
 *
 * Deployed, the worker is a Cloud Run job and the command line is the only
 * thing that knows why it is running: Cloud Scheduler passes `scheduled`, the
 * dashboard's deploy push endpoint passes `deploy`, and a person at a terminal
 * passes nothing and gets `manual`. The `runs` document records exactly what
 * was passed, so the trigger a run reports is a fact about how it was started
 * rather than an inference (AGENTS.md section 2).
 */
import { RUN_TRIGGERS, type RunTrigger } from "@drift/core"

/** What a run says when nobody says otherwise. */
export const DEFAULT_TRIGGER: RunTrigger = "manual"

/** Every spelling, for the usage text and for error messages. */
export const TRIGGERS_LINE = RUN_TRIGGERS.join(" | ")

/**
 * Reads a trigger off the command line. Null for anything else, so an
 * unrecognised value fails the command rather than quietly becoming `manual`
 * and making a scheduled run look like somebody started it by hand.
 */
export function parseTrigger(value: string | undefined): RunTrigger | null {
  if (value === undefined) return DEFAULT_TRIGGER
  const trimmed = value.trim().toLowerCase()
  return RUN_TRIGGERS.find((trigger) => trigger === trimmed) ?? null
}
