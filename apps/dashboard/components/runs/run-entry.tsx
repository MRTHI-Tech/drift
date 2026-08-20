"use client"

/**
 * One run in the feed: when it went, what set it off, how many routes it got
 * through, and how it ended.
 *
 * The latest run opens by default, because the thing a person comes back for is
 * what just happened. Inside it are the findings it raised, each with the same
 * Review action the findings page uses, and above those the pull requests the
 * run opened without being asked.
 */

import * as React from "react"
import {
  RiArrowRightSLine,
  RiExternalLinkLine,
  RiGitPullRequestLine,
} from "@remixicon/react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { FindingLine } from "@/components/findings/finding-line"
import { Timestamp } from "@/components/timestamp"
import {
  count,
  duration,
  runOutcome,
  screenLabel,
  TRIGGER_LABEL,
} from "@/lib/format"
import type { RunView } from "@/lib/data/runs"

export function RunEntry({
  view,
  defaultOpen,
}: {
  view: RunView
  defaultOpen: boolean
}) {
  const { run } = view
  const took = duration(run.startedAt, run.finishedAt)

  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="border-b border-border last:border-b-0"
    >
      <CollapsibleTrigger
        render={
          <Button
            variant="ghost"
            className="group/disclosure h-auto w-full justify-start gap-4 rounded-none px-6 py-4"
          />
        }
      >
        <RiArrowRightSLine className="shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/disclosure:rotate-90" />

        <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm">
              <Timestamp value={run.startedAt} />
            </span>
            <Badge variant="outline">{TRIGGER_LABEL[run.trigger]}</Badge>
            <Badge variant={run.status === "error" ? "destructive" : "outline"}>
              {runOutcome(run)}
            </Badge>
          </span>

          <span className="text-left text-xs leading-relaxed text-muted-foreground">
            {count(run.routesChecked, "route")} checked,{" "}
            {count(view.screensCaptured, "screen")} captured,{" "}
            {count(view.findings.length, "finding")} raised
            {run.knownFindings
              ? `, ${count(run.knownFindings, "value")} already raised`
              : ""}
            {took ? `, in ${took}` : ""}.
          </span>
        </span>

        {view.autoFixes.length > 0 ? (
          <Badge variant="secondary" className="shrink-0">
            {count(view.autoFixes.length, "pull request")}
          </Badge>
        ) : null}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="flex flex-col gap-4 pb-4">
          {run.error ? (
            <p className="px-6 text-xs leading-relaxed text-destructive">
              {run.error}
            </p>
          ) : null}

          {view.autoFixes.length > 0 ? (
            <section className="flex flex-col gap-2 px-6">
              <h3 className="text-xs text-muted-foreground">
                Opened without being asked. Each one is a value that missed its
                token by less than Drift needs a person for.
              </h3>
              <ul className="flex flex-col gap-1.5">
                {view.autoFixes.map((fix) => (
                  <li
                    key={fix.finding.id}
                    className="flex flex-wrap items-center gap-3 border-l-2 border-border py-1 pl-3"
                  >
                    <RiGitPullRequestLine className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-mono text-xs">
                      {fix.screen
                        ? screenLabel(fix.screen.route, fix.screen.viewport)
                        : fix.finding.screenId}
                    </span>
                    <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
                      {fix.sentence}
                    </span>
                    {fix.pullRequestUrl ? (
                      <a
                        className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline underline-offset-3 hover:text-foreground"
                        href={fix.pullRequestUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        #{fix.finding.prNumber}
                        <RiExternalLinkLine className="size-3" />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {view.findings.length === 0 ? (
            <p className="px-6 text-xs leading-relaxed text-muted-foreground">
              This run raised nothing new. A value already raised on a route is
              not raised again, whatever was decided about it.
              {run.knownFindings
                ? ` It did read ${count(run.knownFindings, "value")} that a finding already covers, so what those findings describe is still on the screens.`
                : ""}
            </p>
          ) : (
            <ul className="border-t border-border">
              {view.findings.map((finding) => (
                <FindingLine key={finding.finding.id} view={finding} />
              ))}
            </ul>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
