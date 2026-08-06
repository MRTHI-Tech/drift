import { COLLECTIONS } from "@drift/core"

import { Button } from "@/components/ui/button"

export default function Page() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-md min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-medium">Drift</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Workspace is scaffolded. Nothing is watched yet. The dashboard,
            worker, shared types, and agent packages all build and share one
            toolchain.
          </p>
        </div>

        <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
          <p className="text-card-foreground text-sm">
            Shared types resolve across the workspace.{" "}
            <span className="text-muted-foreground">
              {Object.keys(COLLECTIONS).length} collections are declared in
              @drift/core.
            </span>
          </p>
          <div className="flex gap-2">
            <Button>Primary action</Button>
            <Button variant="secondary">Secondary</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
