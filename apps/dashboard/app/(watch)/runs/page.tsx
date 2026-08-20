/**
 * Runs, newest first (the brief for this phase, and AGENTS.md section 5).
 *
 * Everything on this page is a `runs` document and the `findings` documents
 * pointing at it. Nothing is summarised by a model and nothing is filled in.
 *
 * Two things are here that a plain feed of runs would not have. The banner,
 * because a value already raised on a route is never raised again, so a
 * project that drifted once reads as an unbroken column of runs finding
 * nothing and the standing number has to be said somewhere. And the runs
 * reached back for, because the run that raised what is still waiting is a
 * single run and it falls off the end of the window long before the problem
 * is answered.
 */

import type { Metadata } from "next"

import type { RunStatus } from "@drift/core"

import { PageHeader } from "@/components/page-header"
import { OutcomeFilter } from "@/components/runs/outcome-filter"
import { RunEntry } from "@/components/runs/run-entry"
import { StandingProblems } from "@/components/runs/standing-problems"
import { countByOutcome, loadRuns, ofOutcome } from "@/lib/data/runs"
import { loadWorkspace } from "@/lib/data/workspace"
import { count } from "@/lib/format"

export const metadata: Metadata = { title: "Runs" }

export const dynamic = "force-dynamic"

/** The outcomes a person can ask for, as they are spelled in the URL. */
const OUTCOMES: RunStatus[] = ["clean", "findings", "error"]

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string }>
}) {
  const workspace = await loadWorkspace()
  if (!workspace) return null

  const feed = await loadRuns(workspace.current, workspace.repositories)

  // Read off the URL rather than held in state, so a filtered feed is a page
  // somebody can bookmark and go back out of.
  const asked = (await searchParams).outcome
  const selected = OUTCOMES.find((outcome) => outcome === asked) ?? null
  const counts = countByOutcome(feed)
  const shown = ofOutcome(feed.runs, selected)
  const origins = ofOutcome(feed.origins, selected)

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Runs"
        description={`Every time Drift rendered ${workspace.current.name} and compared it against itself. The latest run is open below.`}
      />

      {feed.runs.length === 0 ? (
        <p className="px-6 py-6 text-xs leading-relaxed text-muted-foreground">
          This project has not run yet. Run the worker against it and this feed
          will fill in:{" "}
          <span className="font-mono">
            pnpm worker -- run --project {workspace.current.id}
          </span>
        </p>
      ) : (
        <>
          <StandingProblems
            groups={feed.standing}
            findingCount={feed.standingCount}
          />

          <p className="border-b border-border px-6 py-3 text-xs text-muted-foreground">
            {count(feed.runs.length, "run")} recorded.
          </p>

          <OutcomeFilter
            counts={counts}
            selected={selected}
            total={feed.runs.length + feed.origins.length}
          />

          {shown.length === 0 ? (
            // Silent when there are older runs below: they are the answer to
            // the filter, and saying "none" above them would contradict them.
            origins.length === 0 ? (
              <p className="px-6 py-6 text-xs leading-relaxed text-muted-foreground">
                No run in the feed ended that way.
              </p>
            ) : null
          ) : (
            <div>
              {shown.map((view, index) => (
                <RunEntry
                  key={view.run.id}
                  view={view}
                  defaultOpen={index === 0 && selected === null}
                />
              ))}
            </div>
          )}

          {origins.length > 0 ? (
            <section className="flex flex-col">
              <h2 className="border-y border-border px-6 py-3 text-xs text-muted-foreground">
                Earlier runs that raised what is still waiting. These sit
                outside the feed above, which reaches back{" "}
                {count(feed.runs.length, "run")}.
              </h2>
              <div>
                {origins.map((view) => (
                  <RunEntry key={view.run.id} view={view} defaultOpen={false} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}
