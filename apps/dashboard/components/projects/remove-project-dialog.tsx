"use client"

/**
 * Removing a project.
 *
 * One of the two deletions in Drift (AGENTS.md section 2), and the only one
 * that reaches more than a single document. So it says exactly what will be
 * lost, counted rather than described, and it asks for the project's name to be
 * typed. There is nothing behind this to undo it, and a dialog whose worst
 * outcome is unrecoverable should cost more than one click.
 *
 * The counts are read when the dialog opens rather than passed in, because they
 * are the one thing on screen that has to be true at the moment of the decision
 * rather than at the moment the page rendered.
 *
 * It is mounted only while it is open, which is what lets it hold no reset
 * logic: every field starts where a fresh mount starts it, and a dialog that
 * was cancelled and reopened cannot show the last attempt's typing or the last
 * project's counts.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { RiLoader4Line } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { count } from "@/lib/format"
import {
  responseMessage,
  type ProjectContents,
  type ProjectSummaryResponse,
} from "@/lib/project-result"

export function RemoveProjectDialog({
  projectId,
  name,
  repo,
  onOpenChange,
}: {
  projectId: string
  name: string
  repo: string
  /** Mounted only while open, so this only ever closes it. */
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()

  const [contents, setContents] = React.useState<ProjectContents | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [typed, setTyped] = React.useState("")
  const [removing, setRemoving] = React.useState(false)
  const [problem, setProblem] = React.useState<string | null>(null)

  React.useEffect(() => {
    let current = true

    async function load() {
      try {
        const response = await fetch(`/api/projects/${projectId}`)
        const payload: unknown = await response.json().catch(() => null)
        if (!current) return

        if (!response.ok) {
          setProblem(responseMessage(payload) ?? "Could not read what this project holds.")
          return
        }
        setContents((payload as ProjectSummaryResponse).contents)
      } catch (error) {
        if (current) setProblem(error instanceof Error ? error.message : String(error))
      } finally {
        if (current) setLoading(false)
      }
    }

    void load()

    return () => {
      current = false
    }
  }, [projectId])

  async function remove() {
    setRemoving(true)
    setProblem(null)

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmName: typed }),
      })
      const payload: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        setProblem(responseMessage(payload) ?? "That project could not be removed.")
        return
      }

      onOpenChange(false)
      // The cookie still names a project that is gone. The workspace falls back
      // to the first one that is left, or to the empty state when none is.
      router.refresh()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setRemoving(false)
    }
  }

  const matches = typed.trim() === name.trim()

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Remove {name}</DialogTitle>
          <DialogDescription>
            Drift stops watching {repo}, and everything it recorded about it is deleted. This
            cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {loading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <RiLoader4Line className="size-4 animate-spin" />
              Counting what this project holds.
            </p>
          ) : null}

          {contents ? <Contents contents={contents} /> : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-name">Type {name} to confirm</Label>
            <Input
              id="confirm-name"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>

          {problem ? (
            <p className="text-xs leading-relaxed text-destructive">{problem}</p>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="ghost" size="sm">
                Cancel
              </Button>
            }
          />
          <Button
            variant="destructive"
            size="sm"
            disabled={!matches || removing || loading}
            onClick={() => void remove()}
          >
            {removing ? <RiLoader4Line className="animate-spin" /> : null}
            Remove this project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** What is about to be lost, counted. */
function Contents({ contents }: { contents: ProjectContents }) {
  const rows: string[] = [
    count(contents.runs, "run"),
    count(contents.screens, "screen"),
    count(contents.findings, "finding"),
    count(contents.resolutions, "resolution"),
    count(contents.conventions, "convention"),
    count(contents.archetypes, "archetype"),
  ]

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs leading-relaxed">This deletes {sentence(rows)}.</p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Every screenshot this project captured is deleted from the bucket with it. Resolutions
        are append-only everywhere else in Drift, and are removed here because nothing could
        read them again once the project is gone.
      </p>
    </div>
  )
}

/** `a, b and c`, so the count reads as a sentence rather than a list. */
function sentence(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "nothing"
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}
