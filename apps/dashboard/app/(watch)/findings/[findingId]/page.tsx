/**
 * One finding, and the decision about it. The centrepiece of the dashboard.
 *
 * A pattern finding gets the comparison view: the divergent screen's real
 * capture beside the real captures of the screens its value was counted
 * against, the element boxed on each, the evidence stated in plain language,
 * and the three ways to answer it.
 *
 * A token finding gets the simpler card. It has no siblings, because a token is
 * declared rather than counted, so there is nothing to put beside it and one
 * action to take about it.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { RiArrowLeftLine } from "@remixicon/react"

import { ComparisonView } from "@/components/comparison-view"
import { EvidenceRows } from "@/components/findings/evidence-rows"
import { ResolutionActions } from "@/components/findings/resolution-actions"
import { SettledNotice } from "@/components/findings/settled-notice"
import { ScreenThumbnail } from "@/components/screen-thumbnail"
import { Timestamp } from "@/components/timestamp"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { loadFindingDetail } from "@/lib/data/findings"
import { loadWorkspace } from "@/lib/data/workspace"
import { screenLabel } from "@/lib/format"

export const metadata: Metadata = { title: "Finding" }

export const dynamic = "force-dynamic"

export default async function FindingPage({
  params,
}: {
  params: Promise<{ findingId: string }>
}) {
  const { findingId } = await params
  const workspace = await loadWorkspace()
  if (!workspace) notFound()

  const detail = await loadFindingDetail(
    findingId,
    workspace.current,
    workspace.repositories
  )
  if (!detail) notFound()

  const { finding, divergent, siblings, archetype } = detail
  const open = finding.status === "open"

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          nativeButton={false}
          render={<Link href="/findings" />}
        >
          <RiArrowLeftLine data-icon="inline-start" />
          All findings
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={finding.type === "pattern" ? "secondary" : "outline"}>
            {finding.type === "pattern" ? "Pattern drift" : "Token drift"}
          </Badge>
          <span className="font-mono text-xs">
            {divergent
              ? screenLabel(divergent.route, divergent.viewport)
              : finding.screenId}
          </span>
          <span className="text-xs text-muted-foreground">
            raised <Timestamp value={finding.createdAt} relative />
          </span>
        </div>

        <h1 className="max-w-3xl font-heading text-lg leading-relaxed">
          {detail.sentence}
        </h1>
      </div>

      {finding.type === "pattern" && divergent ? (
        <ComparisonView
          divergent={divergent}
          siblings={siblings}
          selector={finding.evidence.selector}
          observedValue={finding.evidence.observedValue}
          expectedValue={finding.evidence.expectedValue}
          archetypeLabel={archetype?.label ?? null}
        />
      ) : null}

      {finding.type === "token" && divergent ? (
        <div className="max-w-sm">
          <ScreenThumbnail
            screenId={divergent.id}
            route={divergent.route}
            viewport={divergent.viewport}
            highlight={
              finding.evidence.selector
                ? (divergent.computedStyles[finding.evidence.selector]?.box ??
                  null)
                : null
            }
            size="tall"
            revealHighlight
            marker={<Badge>Off the scale</Badge>}
          />
        </div>
      ) : null}

      {!divergent ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          The screen this finding cites is no longer stored, so there is nothing
          to show beside it. The evidence below is what was read off it at the
          time.
        </p>
      ) : null}

      <Separator />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Evidence</h2>
        <div className="max-w-3xl">
          <EvidenceRows
            evidence={finding.evidence}
            kind={finding.type}
            archetypeLabel={archetype?.label ?? null}
          />
        </div>
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">
          {open ? "What should happen" : "What happened"}
        </h2>

        {open ? (
          <ResolutionActions
            findingId={finding.id}
            kind={finding.type}
            observedValue={finding.evidence.observedValue}
            expectedValue={finding.evidence.expectedValue}
            siblingCount={finding.evidence.siblingScreenIds.length}
          />
        ) : (
          <SettledNotice
            status={finding.status}
            resolutions={detail.resolutions}
            pullRequestUrl={detail.pullRequestUrl}
            prNumber={finding.prNumber}
          />
        )}
      </section>
    </div>
  )
}
