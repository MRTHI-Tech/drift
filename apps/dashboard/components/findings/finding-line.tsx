/**
 * One finding as a line: what it is about, the sentence stating the evidence,
 * and the way to it.
 *
 * The sentence is the one the judgment phase wrote for a pattern finding, and
 * the one Drift composes from the value and its token for a token finding. It
 * is never rewritten here (AGENTS.md section 6).
 *
 * The heading is what the property is called in English, with the kind beside
 * it, because a row reading `cta.voice` above one reading `background-color`
 * asks a person to learn two naming schemes before they can read the list.
 * Both come from one table in `@drift/core` so the list, the filter and the
 * detail page cannot disagree about what a thing is called.
 *
 * A row may stand for more than one finding. When the same value misses the
 * same token on several screens it is one problem with one fix, so the row
 * names the screens rather than repeating itself once per screen. The link
 * still goes to one finding, the oldest, which is the one actuation acts on.
 */

import Link from "next/link"
import { RiArrowRightUpLine, RiExternalLinkLine } from "@remixicon/react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Timestamp } from "@/components/timestamp"
import { FINDING_KIND_LABEL, propertyReading } from "@drift/core/vocabulary"

import { count, FINDING_STATUS_LABEL, screenLabel } from "@/lib/format"
import type { FindingView } from "@/lib/data/findings"

/** Screens named in full before the row starts summarising instead. */
const NAMED_SCREENS = 4

export function FindingLine({
  view,
  others = [],
  action = "Review",
}: {
  view: FindingView
  /** Other screens showing the same problem. Empty for a lone finding. */
  others?: readonly FindingView[]
  action?: string
}) {
  const { finding, screen, sentence } = view
  const open = finding.status === "open"
  const reading = propertyReading(finding.evidence.property)

  const screens = [view, ...others]
    .map((entry) => entry.screen)
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  const routes = [...new Set(screens.map((entry) => entry.route))]
  const shared = others.length > 0

  return (
    <li className="flex items-start gap-4 border-b border-border px-6 py-4 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Badge variant="outline">{FINDING_KIND_LABEL[reading.kind]}</Badge>
          <span className="text-sm font-medium">{reading.label}</span>
          <span className="text-xs text-muted-foreground">
            {shared
              ? `on ${count(screens.length, "screen")}`
              : screen
                ? `on ${screenLabel(screen.route, screen.viewport)}`
                : `on ${finding.screenId}`}
          </span>
          {open ? null : (
            <Badge variant="outline">
              {FINDING_STATUS_LABEL[finding.status]}
            </Badge>
          )}
        </div>

        <p className="max-w-3xl text-xs leading-relaxed">{sentence}</p>

        {shared ? (
          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
            One value, one fix. Seen on{" "}
            <span className="font-mono">
              {routes.slice(0, NAMED_SCREENS).join(", ")}
            </span>
            {routes.length > NAMED_SCREENS
              ? ` and ${routes.length - NAMED_SCREENS} more.`
              : "."}{" "}
            Deciding here decides all of them.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>
            Raised <Timestamp value={finding.createdAt} relative />
          </span>
          {view.pullRequestUrl ? (
            <a
              className="inline-flex items-center gap-1 underline underline-offset-3 hover:text-foreground"
              href={view.pullRequestUrl}
              target="_blank"
              rel="noreferrer"
            >
              Pull request #{finding.prNumber}
              <RiExternalLinkLine className="size-3" />
            </a>
          ) : null}
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link href={`/findings/${finding.id}`} />}
      >
        {open ? action : "Open"}
        <RiArrowRightUpLine data-icon="inline-end" />
      </Button>
    </li>
  )
}
