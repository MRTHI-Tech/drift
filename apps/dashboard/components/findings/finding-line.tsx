/**
 * One finding as a line: what it is about, the sentence stating the evidence,
 * and the way to it.
 *
 * The sentence is the one the judgment phase wrote for a pattern finding, and
 * the one Drift composes from the value and its token for a token finding. It
 * is never rewritten here (AGENTS.md section 6).
 */

import Link from "next/link"
import { RiArrowRightUpLine, RiExternalLinkLine } from "@remixicon/react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Timestamp } from "@/components/timestamp"
import { FINDING_STATUS_LABEL, screenLabel } from "@/lib/format"
import type { FindingView } from "@/lib/data/findings"

export function FindingLine({
  view,
  action = "Review",
}: {
  view: FindingView
  action?: string
}) {
  const { finding, screen, sentence } = view
  const open = finding.status === "open"

  return (
    <li className="flex items-start gap-4 border-b border-border px-6 py-4 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={finding.type === "pattern" ? "secondary" : "outline"}>
            {finding.type === "pattern" ? "Pattern" : "Token"}
          </Badge>
          <span className="font-mono text-xs">
            {screen
              ? screenLabel(screen.route, screen.viewport)
              : finding.screenId}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {finding.evidence.property}
          </span>
          {open ? null : (
            <Badge variant="outline">
              {FINDING_STATUS_LABEL[finding.status]}
            </Badge>
          )}
        </div>

        <p className="max-w-3xl text-xs leading-relaxed">{sentence}</p>

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
        render={<Link href={`/findings/${finding.id}`} />}
      >
        {open ? action : "Open"}
        <RiArrowRightUpLine data-icon="inline-end" />
      </Button>
    </li>
  )
}
