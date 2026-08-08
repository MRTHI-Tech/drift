"use client"

/**
 * What the shell shows when Firestore holds no project. Not an error: nothing is
 * being watched yet, and the way to fix that is right here.
 *
 * The command is still offered underneath, because `pnpm seed` and this dialog
 * call the same `createProject` and a terminal is sometimes the faster way in.
 */

import { RiAddLine } from "@remixicon/react"

import { AddProjectDialog } from "@/components/projects/add-project-dialog"
import { Button } from "@/components/ui/button"

export function NoProjects({
  email,
  onCreated,
}: {
  email: string | null
  /** Records the new project as the current one. The layout's server action. */
  onCreated: (projectId: string) => Promise<void>
}) {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-lg flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-lg">Drift</h1>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Signed in as {email ?? "an account with no address"}. No project is
            being watched yet.
          </p>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Drift needs a repo and the URL its preview is deployed at. It reads the
          routes, the viewports and the token file out of the repo itself.
        </p>

        <div>
          <AddProjectDialog
            onCreated={onCreated}
            trigger={
              <Button size="sm">
                <RiAddLine />
                Add project
              </Button>
            }
          />
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Or from a terminal, which goes through exactly the same path:
        </p>
        <pre className="overflow-x-auto bg-secondary p-3 font-mono text-xs text-foreground">
          {`pnpm seed --name "Acme" --repo "acme/web" \\\n  --preview-url "https://acme-preview.a.run.app"`}
        </pre>
      </div>
    </div>
  )
}
