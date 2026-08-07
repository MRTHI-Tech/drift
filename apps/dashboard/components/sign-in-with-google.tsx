"use client"

/**
 * The one place the Firebase client SDK is used. Google provider only
 * (AGENTS.md section 1).
 *
 * The popup gives an ID token, the token is exchanged for the session cookie at
 * `/api/auth/session`, and only then does the browser move. Nothing about the
 * signed-in person is kept in client state: the cookie is the session, and
 * every page reads it on the server.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { initializeApp, getApp, getApps, type FirebaseApp } from "firebase/app"
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  type Auth,
} from "firebase/auth"
import { RiGoogleFill, RiLoader4Line } from "@remixicon/react"

import type { FirebaseClientConfig } from "@/lib/firebase-config"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

const APP_NAME = "drift-dashboard"

function clientAuth(config: FirebaseClientConfig): Auth {
  const existing = getApps().find((app) => app.name === APP_NAME)
  const app: FirebaseApp = existing
    ? getApp(APP_NAME)
    : initializeApp(config, APP_NAME)
  return getAuth(app)
}

export function SignInWithGoogle({ config }: { config: FirebaseClientConfig }) {
  const router = useRouter()
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function signIn() {
    setPending(true)
    setError(null)

    try {
      const credential = await signInWithPopup(
        clientAuth(config),
        new GoogleAuthProvider()
      )
      const idToken = await credential.user.getIdToken()

      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      })

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null)
        throw new Error(readError(body) ?? "That sign-in was not accepted.")
      }

      router.replace("/runs")
      router.refresh()
    } catch (cause) {
      setError(
        closed(cause)
          ? "The sign-in window closed before it finished."
          : describe(cause)
      )
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button onClick={signIn} disabled={pending} size="lg">
        {pending ? (
          <RiLoader4Line className="animate-spin" data-icon="inline-start" />
        ) : (
          <RiGoogleFill data-icon="inline-start" />
        )}
        {pending ? "Signing in" : "Continue with Google"}
      </Button>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Sign-in did not finish</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

/** The person shut the popup. Not a failure worth a stack trace. */
function closed(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause.code === "auth/popup-closed-by-user" ||
      cause.code === "auth/cancelled-popup-request")
  )
}

function readError(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const error = (body as Record<string, unknown>).error
  return typeof error === "string" ? error : null
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
