/**
 * Narrowing the feed to runs that ended one way.
 *
 * The same shape as the findings kind filter: a link per outcome rather than a
 * control with state, because the page is rendered on the server and a filter
 * that lives in the URL is one a person can bookmark, share, and go back out
 * of. Outcomes with no runs under them are left out, so the row never offers a
 * filter that leads to an empty page.
 *
 * The one people come for is "raised something". A project mostly reports
 * nothing new, and scrolling a month of that to find the run that actually
 * said something is the thing this exists to skip.
 */

import Link from "next/link"

import type { RunStatus } from "@drift/core"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RUN_STATUS_FILTER_LABEL } from "@/lib/format"

/** The outcomes, ordered as the filter shows them. */
const OUTCOMES: RunStatus[] = ["findings", "clean", "error"]

export function OutcomeFilter({
  counts,
  selected,
  total,
}: {
  /** How many runs ended each way. */
  counts: Record<RunStatus, number>
  selected: RunStatus | null
  total: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
      <Button
        variant={selected === null ? "secondary" : "ghost"}
        size="sm"
        nativeButton={false}
        render={<Link href="/runs" />}
      >
        Everything
        <Badge variant="outline">{total}</Badge>
      </Button>

      {OUTCOMES.map((outcome) => {
        const found = counts[outcome]
        if (found === 0) return null

        return (
          <Button
            key={outcome}
            variant={selected === outcome ? "secondary" : "ghost"}
            size="sm"
            nativeButton={false}
            render={<Link href={`/runs?outcome=${outcome}`} />}
          >
            {RUN_STATUS_FILTER_LABEL[outcome]}
            <Badge variant="outline">{found}</Badge>
          </Button>
        )
      })}
    </div>
  )
}
