"use client"

/**
 * Top of the nav (AGENTS.md section 5): the repo name and its mark, and in the
 * menu every watched project with its unresolved count and its drift score, so
 * switching is a decision made with the numbers in front of you.
 *
 * The chosen project is a cookie rather than a path segment, so switching keeps
 * you on the page you were on. The cookie is written by a server action, so
 * nothing in the browser has to be able to read it.
 */

import * as React from "react"
import { RiExpandUpDownLine } from "@remixicon/react"
import type { Project } from "@drift/core/types"

import { count } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export interface SwitchableProject {
  project: Project
  openFindings: number
}

export function ProjectSwitcher({
  projects,
  current,
  onChoose,
}: {
  projects: readonly SwitchableProject[]
  current: Project
  /** The server action that records the choice. Also used after one is added. */
  onChoose: (projectId: string) => Promise<void>
}) {
  const [, startTransition] = React.useTransition()

  function choose(projectId: string) {
    if (projectId === current.id) return
    startTransition(() => onChoose(projectId))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="h-auto w-full justify-start px-2 py-2"
          />
        }
      >
        <ProjectMark name={current.name} />
        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <span className="w-full truncate text-sm font-medium">
            {current.name}
          </span>
          <span className="w-full truncate font-mono text-xs text-muted-foreground">
            {current.repo}
          </span>
        </span>
        <RiExpandUpDownLine className="text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Watched projects</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {projects.map(({ project, openFindings }) => (
          <DropdownMenuItem
            key={project.id}
            onClick={() => choose(project.id)}
            className="items-start gap-2"
          >
            <ProjectMark name={project.name} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate">{project.name}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {project.repo}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {openFindings > 0 ? (
                <Badge title={count(openFindings, "unresolved finding")}>
                  {openFindings}
                </Badge>
              ) : null}
              <span
                className="font-mono text-xs text-muted-foreground"
                title="Drift score"
              >
                {project.driftScore}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The project's mark: its initials, which is all Drift knows about a repo. */
function ProjectMark({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("")

  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-xs text-secondary-foreground"
    >
      {initials || "?"}
    </span>
  )
}
