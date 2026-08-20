/**
 * Findings: what is waiting, and what has been decided.
 *
 * Waiting first, because a finding is an observation somebody has to answer.
 * The settled list stays visible rather than disappearing: findings are never
 * deleted (AGENTS.md section 2), and a decision that cannot be looked up later
 * is a decision nobody can check.
 */

import type { Metadata } from "next"

import { FINDING_KINDS } from "@drift/core/vocabulary"

import { FindingLine } from "@/components/findings/finding-line"
import { KindFilter } from "@/components/findings/kind-filter"
import { PageHeader } from "@/components/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { countByKind, loadFindings, ofKind } from "@/lib/data/findings"
import { loadWorkspace } from "@/lib/data/workspace"
import { count } from "@/lib/format"

export const metadata: Metadata = { title: "Findings" }

export const dynamic = "force-dynamic"

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>
}) {
  const workspace = await loadWorkspace()
  if (!workspace) return null

  const { open, openCount, settled } = await loadFindings(
    workspace.current,
    workspace.repositories
  )

  // Read off the URL rather than held in state, so a filtered list is a page
  // somebody can bookmark and go back out of.
  const asked = (await searchParams).kind
  const selected = FINDING_KINDS.find((kind) => kind === asked) ?? null
  const counts = countByKind(open)
  const shown = ofKind(open, selected)

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Findings"
        description="Each one is a value Drift read off a rendered screen, with the screens it was compared against. Every one of them is a choice, not a verdict."
      />

      <Tabs defaultValue="open">
        <div className="border-b border-border px-6 py-3">
          <TabsList>
            <TabsTrigger value="open">Waiting ({open.length})</TabsTrigger>
            <TabsTrigger value="settled">
              Decided ({settled.length})
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="open">
          {open.length === 0 ? (
            <p className="px-6 py-6 text-xs leading-relaxed text-muted-foreground">
              Nothing is waiting. Every finding raised against{" "}
              {workspace.current.name} has been answered.
            </p>
          ) : (
            <>
              {openCount > open.length ? (
                <p className="border-b border-border px-6 py-3 text-xs text-muted-foreground">
                  {count(openCount, "finding")} on{" "}
                  {count(open.length, "problem")}. The same value missing the
                  same token on several screens is one thing to decide.
                </p>
              ) : null}

              <KindFilter
                counts={counts}
                selected={selected}
                total={open.length}
              />

              {shown.length === 0 ? (
                <p className="px-6 py-6 text-xs leading-relaxed text-muted-foreground">
                  Nothing of that kind is waiting.
                </p>
              ) : (
                <ul>
                  {shown.map((group) => (
                    <FindingLine
                      key={group.lead.finding.id}
                      view={group.lead}
                      others={group.others}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="settled">
          {settled.length === 0 ? (
            <p className="px-6 py-6 text-xs leading-relaxed text-muted-foreground">
              Nothing has been decided yet.
            </p>
          ) : (
            <>
              <p className="border-b border-border px-6 py-3 text-xs text-muted-foreground">
                {count(settled.length, "decision")} recorded, oldest at the
                bottom.
              </p>
              <ul>
                {settled.map((view) => (
                  <FindingLine key={view.finding.id} view={view} />
                ))}
              </ul>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
