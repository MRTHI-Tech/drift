/**
 * Narrowing the list to one kind of problem.
 *
 * A link per kind rather than a control with state, because the page is
 * rendered on the server and a filter that lives in the URL is one a person
 * can bookmark, share, and go back out of. Kinds with nothing under them are
 * shown and disabled rather than hidden, so the row does not reshuffle itself
 * every time a run changes what is open.
 */

import Link from "next/link"

import { FINDING_KINDS, FINDING_KIND_LABEL, type FindingKind } from "@drift/core/vocabulary"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export function KindFilter({
  counts,
  selected,
  total,
}: {
  /** How many problems each kind has waiting. */
  counts: Record<FindingKind, number>
  selected: FindingKind | null
  total: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
      <Button
        variant={selected === null ? "secondary" : "ghost"}
        size="sm"
        nativeButton={false}
        render={<Link href="/findings" />}
      >
        Everything
        <Badge variant="outline">{total}</Badge>
      </Button>

      {FINDING_KINDS.map((kind) => {
        const found = counts[kind]
        if (found === 0) return null

        return (
          <Button
            key={kind}
            variant={selected === kind ? "secondary" : "ghost"}
            size="sm"
            nativeButton={false}
            render={<Link href={`/findings?kind=${kind}`} />}
          >
            {FINDING_KIND_LABEL[kind]}
            <Badge variant="outline">{found}</Badge>
          </Button>
        )
      })}
    </div>
  )
}
