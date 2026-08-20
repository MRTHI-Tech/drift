/**
 * How the interface writes numbers, dates and names. Sentence case, no filler,
 * exact values (AGENTS.md section 6).
 *
 * Everything here uses `Intl` rather than a date library (AGENTS.md section 7).
 */

import type {
  Confidence,
  FindingStatus,
  Run,
  RunStatus,
  RunTrigger,
} from "@drift/core"

/** A moment as a person reads it: 7 Aug, 14:32. */
export function timestamp(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value)
}

/** A moment with its year, for anything that could be months old. */
export function fullTimestamp(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value)
}

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 1000],
  ["minute", 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["year", 365 * 24 * 60 * 60 * 1000],
]

/** How long ago, in the largest unit that still reads as a number. */
export function relativeTime(value: Date, now: Date = new Date()): string {
  const elapsed = value.getTime() - now.getTime()
  const magnitude = Math.abs(elapsed)

  let unit: Intl.RelativeTimeFormatUnit = "second"
  let step = 1000
  for (const [candidate, size] of RELATIVE_STEPS) {
    if (magnitude < size) break
    unit = candidate
    step = size
  }

  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    Math.round(elapsed / step),
    unit
  )
}

/** How long a run took, or null while it is still going. */
export function duration(
  startedAt: Date,
  finishedAt: Date | null
): string | null {
  if (!finishedAt) return null

  const seconds = Math.max(
    0,
    Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)
  )
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

/** `2 findings`, `1 finding`, `no findings`. */
export function count(
  value: number,
  singular: string,
  plural = `${singular}s`
): string {
  if (value === 0) return `no ${plural}`
  return `${value} ${value === 1 ? singular : plural}`
}

/** What set a run off, in words. */
export const TRIGGER_LABEL: Record<RunTrigger, string> = {
  scheduled: "on schedule",
  deploy: "after a deploy",
  manual: "started by hand",
}

/** How a run ended, in words. */
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  clean: "nothing to report",
  findings: "findings raised",
  error: "did not finish",
}

/** The same three, as a person picks them off a filter. */
export const RUN_STATUS_FILTER_LABEL: Record<RunStatus, string> = {
  findings: "Raised something",
  clean: "Nothing new",
  error: "Did not finish",
}

/**
 * How a run ended, said so that a clean run does not overstate itself.
 *
 * A run is clean when it raised nothing new, which is not the same as having
 * found nothing: a value already raised on a route is never raised again. A
 * run that suppressed twelve sightings and a run that saw none are both clean,
 * and only one of them has nothing to report.
 *
 * Runs written before the count existed carry null and keep the old words,
 * because inventing a number for them would be worse than saying less.
 */
export function runOutcome(run: Run): string {
  if (run.status !== "clean") return RUN_STATUS_LABEL[run.status]
  return run.knownFindings ? "nothing new" : RUN_STATUS_LABEL.clean
}

/** What was decided about a finding, in words. */
export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  open: "waiting",
  resolved_conform: "screen conformed",
  resolved_update_siblings: "convention moved here",
  resolved_exception: "accepted as an exception",
  dismissed: "dismissed",
}

/** How sure a convention is, in words. */
export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "high confidence",
  medium: "medium confidence",
  low: "low confidence",
}

/** A route and viewport as one label: `/pricing at mobile`. */
export function screenLabel(route: string, viewport: string): string {
  return `${route} at ${viewport}`
}
