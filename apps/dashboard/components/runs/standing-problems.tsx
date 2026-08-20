/**
 * What the feed is being quiet about.
 *
 * A run reports what it raised, and a value already raised on a route is never
 * raised again. So a project that drifted once and was never answered reads as
 * an unbroken column of runs finding nothing, which is true of each run and
 * gives the wrong impression of the project. This says the standing number
 * once, at the top, in the same grouping and the same words the findings page
 * uses, so the two pages cannot disagree about how many things are waiting.
 *
 * Renders nothing when nothing is waiting, so a project that is genuinely
 * clear looks clear.
 */

import Link from "next/link"

import type { FindingGroup } from "@/lib/data/findings"

import { Button } from "@/components/ui/button"
import { Timestamp } from "@/components/timestamp"
import { count } from "@/lib/format"

export function StandingProblems({
  groups,
  findingCount,
}: {
  /** Waiting problems, grouped by cause. */
  groups: FindingGroup[]
  /** How many findings those groups stand for. */
  findingCount: number
}) {
  if (groups.length === 0) return null

  // The most recent thing raised. Groups are ordered by size rather than by
  // age, so the date has to be looked for rather than read off the first row.
  const latest = new Date(
    Math.max(...groups.map((group) => group.lead.finding.createdAt.getTime()))
  )

  return (
    <section className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-6 py-4">
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
        <span className="text-foreground">
          {count(groups.length, "problem")} still waiting
        </span>
        {findingCount > groups.length
          ? `, seen ${count(findingCount, "time")} across the screens`
          : ""}
        . The most recent was raised{" "}
        <Timestamp value={latest} withYear />, and no run since has found
        anything new.
      </p>

      <Button variant="secondary" size="sm" nativeButton={false} render={<Link href="/findings" />}>
        Review them
      </Button>
    </section>
  )
}
