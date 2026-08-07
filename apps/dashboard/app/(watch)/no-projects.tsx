/**
 * What the shell shows when Firestore holds no project. Not an error: nothing
 * has been seeded yet, and the way to seed one is a command.
 */

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export function NoProjects({ email }: { email: string | null }) {
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

        <Alert>
          <AlertTitle>Seed a project first</AlertTitle>
          <AlertDescription>
            <p>
              A project needs a name, a repo and a preview URL before anything
              can be rendered against it. From the repo root:
            </p>
            <pre className="overflow-x-auto font-mono text-xs text-foreground">
              {`pnpm seed --name "Acme" --repo "acme/web" \\\n  --preview-url "https://acme-preview.a.run.app"`}
            </pre>
            <p>
              Then run the worker once, and this page will have runs to show.
            </p>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  )
}
