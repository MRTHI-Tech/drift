/**
 * The only page reachable without a session (AGENTS.md section 1). Google
 * provider only, one user, no sign-up.
 */

import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { SignInWithGoogle } from "@/components/sign-in-with-google"
import { readFirebaseClientConfig } from "@/lib/firebase-config"
import { readSession } from "@/lib/session"

export const metadata: Metadata = {
  title: "Sign in to Drift",
}

// The session is read per request, so this page is never prerendered.
export const dynamic = "force-dynamic"

export default async function LoginPage() {
  if (await readSession()) redirect("/runs")

  const firebase = readFirebaseClientConfig()

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-lg">Drift</h1>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Drift watches a deployed product for design drift. Sign in to see
            what the last run found.
          </p>
        </div>

        {firebase.config ? (
          <SignInWithGoogle config={firebase.config} />
        ) : (
          <Alert variant="destructive">
            <AlertTitle>Firebase Auth is not configured</AlertTitle>
            <AlertDescription>
              <p>
                {firebase.missing.join(", ")}{" "}
                {firebase.missing.length === 1 ? "is" : "are"} not set. The
                canonical list is in AGENTS.md section 8; the values go in{" "}
                <span className="font-mono">.env.local</span>.
              </p>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  )
}
