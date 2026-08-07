/**
 * Conventions, grouped by archetype, because that is how they were derived: a
 * convention is a property of a family of screens.
 *
 * Every value on this page was counted rather than concluded. A convention
 * needs three or more agreeing screens before it exists at all (AGENTS.md
 * section 2), which is why each row states how many it was measured on and
 * opens onto those screens.
 */

import type { Metadata } from "next"

import { ConventionRow } from "@/components/convention-row"
import { RulesFileCard } from "@/components/conventions/rules-file-card"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { loadConventions, loadRulesFile } from "@/lib/data/conventions"
import { loadWorkspace } from "@/lib/data/workspace"
import { count } from "@/lib/format"

export const metadata: Metadata = { title: "Conventions" }

export const dynamic = "force-dynamic"

export default async function ConventionsPage() {
  const workspace = await loadWorkspace()
  if (!workspace) return null

  const { groups, productWide } = await loadConventions(
    workspace.current,
    workspace.repositories
  )
  const rules = await loadRulesFile(workspace.current, workspace.repositories)

  const stated = groups.filter((group) => group.conventions.length > 0)
  const total =
    stated.reduce((sum, group) => sum + group.conventions.length, 0) +
    productWide.length

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Conventions"
        description="What this product already does, counted across its own screens. A value becomes a convention when it is the single most common one across three or more screens of a family."
      />

      <div className="flex flex-col gap-8 p-6">
        <RulesFileCard
          path={rules.path}
          branch={rules.branch}
          repo={workspace.current.repo}
          content={rules.content}
          lastSync={
            rules.lastSync
              ? {
                  at: rules.lastSync.at.toISOString(),
                  sha: rules.lastSync.sha,
                  url: rules.lastSync.url,
                }
              : null
          }
          syncError={rules.syncError}
        />

        {total === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            No conventions have been measured yet. A family of screens has to
            agree on a value across three or more of them before Drift states
            anything about it.
          </p>
        ) : null}

        {stated.map((group) => (
          <section
            key={group.archetype?.id ?? "unfiled"}
            className="flex flex-col gap-3"
          >
            <header className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium">
                {group.archetype?.label ?? "Unfiled"}
              </h2>
              <Badge variant="outline">
                {count(group.screens.length, "screen")}
              </Badge>
              <Badge variant="outline">
                {count(group.conventions.length, "convention")}
              </Badge>
            </header>

            <div className="bg-card ring-1 ring-foreground/10">
              {group.conventions.map((view) => (
                <ConventionRow
                  key={view.convention.id}
                  convention={view.convention}
                  evidence={view.evidence}
                  exceptions={view.exceptions}
                />
              ))}
            </div>
          </section>
        ))}

        {productWide.length > 0 ? (
          <section className="flex flex-col gap-3">
            <header className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium">Everywhere</h2>
              <Badge variant="outline">
                {count(productWide.length, "convention")}
              </Badge>
            </header>

            <div className="bg-card ring-1 ring-foreground/10">
              {productWide.map((view) => (
                <ConventionRow
                  key={view.convention.id}
                  convention={view.convention}
                  evidence={view.evidence}
                  exceptions={view.exceptions}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
