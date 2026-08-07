/**
 * Nav footer (AGENTS.md section 5): the drift score, with the sparkline of
 * where it has been.
 *
 * The number is stated with what it was computed from, because a score nobody
 * can reconstruct is a score nobody trusts: open findings, screens checked, and
 * the ratio between them is the whole formula.
 */

import { Sparkline } from "@/components/sparkline"
import { Timestamp } from "@/components/timestamp"
import { count } from "@/lib/format"
import type { ScoreTrend } from "@/lib/data/score"

export function DriftScoreFooter({
  trend,
  lastRunAt,
}: {
  trend: ScoreTrend
  lastRunAt: Date | null
}) {
  const previous = trend.points[trend.points.length - 2]?.score ?? null
  const movement = previous === null ? null : trend.score - previous

  return (
    <section className="flex flex-col gap-2" aria-label="Drift score">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Drift score</span>
          <span className="font-heading text-2xl leading-none transition-all">
            {trend.score}
          </span>
        </div>

        <Sparkline
          points={trend.points}
          label={`Drift score over the last ${count(trend.points.length, "run")}`}
          className="h-6 w-24 text-primary"
        />
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {count(trend.openFindings, "open finding")} across{" "}
        {count(trend.screensChecked, "screen")} checked.
        {movement !== null && movement !== 0
          ? ` ${movement > 0 ? "Up" : "Down"} ${Math.abs(movement)} since the run before last.`
          : null}
      </p>

      {lastRunAt ? (
        <p className="text-xs text-muted-foreground">
          Last run <Timestamp value={lastRunAt} relative />.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          This project has not run yet.
        </p>
      )}
    </section>
  )
}
