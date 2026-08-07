/**
 * Runs, newest first (the brief for this phase, and AGENTS.md section 5).
 *
 * Everything on this page is a `runs` document and the `findings` documents
 * pointing at it. Nothing is summarised by a model and nothing is filled in.
 */

import type { Metadata } from "next"

import { PageHeader } from "@/components/page-header"
import { RunEntry } from "@/components/runs/run-entry"
import { loadRuns } from "@/lib/data/runs"
import { loadWorkspace } from "@/lib/data/workspace"
import { count } from "@/lib/format"

export const metadata: Metadata = { title: "Runs" }

export const dynamic = "force-dynamic"

export default async function RunsPage() {
  const workspace = await loadWorkspace()
  if (!workspace) return null

  const runs = await loadRuns(workspace.current, workspace.repositories)

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Runs"
        description={`Every time Drift rendered ${workspace.current.name} and compared it against itself. The latest run is open below.`}
      />

      {runs.length === 0 ? (
        <p className="px-6 py-6 text-xs leading-relaxed text-muted-foreground">
          This project has not run yet. Run the worker against it and this feed
          will fill in:{" "}
          <span className="font-mono">
            pnpm worker -- run --project {workspace.current.id}
          </span>
        </p>
      ) : (
        <>
          <p className="border-b border-border px-6 py-3 text-xs text-muted-foreground">
            {count(runs.length, "run")} recorded.
          </p>
          <div>
            {runs.map((view, index) => (
              <RunEntry
                key={view.run.id}
                view={view}
                defaultOpen={index === 0}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
