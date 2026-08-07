/**
 * The signed-in shell: persistent left nav, one scrolling column beside it
 * (AGENTS.md section 5).
 *
 * The session is verified here, on the server, for every page inside this
 * group. `proxy.ts` only redirected somebody without a cookie; this is the
 * check that a cookie has to survive.
 */

import { Separator } from "@/components/ui/separator"
import { AccountMenu } from "@/components/nav/account-menu"
import { DriftScoreFooter } from "@/components/nav/drift-score-footer"
import { NavLinks } from "@/components/nav/nav-links"
import { ProjectSwitcher } from "@/components/nav/project-switcher"
import { loadScoreTrend } from "@/lib/data/score"
import { loadWorkspace } from "@/lib/data/workspace"
import { requireSession } from "@/lib/session"
import { chooseProject } from "./actions"
import { NoProjects } from "./no-projects"

export default async function WatchLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await requireSession()
  const workspace = await loadWorkspace()

  if (!workspace) {
    return <NoProjects email={session.email} />
  }

  const trend = await loadScoreTrend(workspace.current, workspace.repositories)

  return (
    <div className="flex min-h-svh">
      <aside className="sticky top-0 flex h-svh w-64 shrink-0 flex-col gap-4 border-r border-border bg-sidebar p-3 text-sidebar-foreground">
        <ProjectSwitcher
          projects={workspace.projects}
          current={workspace.current}
          onChoose={chooseProject}
        />

        <Separator />

        <NavLinks openFindings={workspace.currentOpenFindings} />

        <div className="mt-auto flex flex-col gap-3">
          <DriftScoreFooter
            trend={trend}
            lastRunAt={workspace.current.lastRunAt}
          />
          <Separator />
          <AccountMenu
            name={session.name}
            email={session.email}
            picture={session.picture}
          />
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
