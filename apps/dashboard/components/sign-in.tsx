"use client"

/**
 * The one place the Firebase client SDK is used.
 *
 * Google is the provider (AGENTS.md section 1). Whichever way the person signs
 * in, the shape is the same: the SDK gives an ID token, the token is exchanged
 * for the session cookie at `/api/auth/session`, and only then does the browser
 * move. Nothing about the signed-in person is kept in client state.
 *
 * Persistence is deliberately in memory. The Firebase SDK's default is
 * IndexedDB, which is what raises "Database is closing/hidden" in some browser
 * states, and Drift has no use for it: the session is the httpOnly cookie the
 * server minted, and the client is never asked who is signed in. Nothing is
 * kept in the browser that has to survive a reload, so nothing needs a database
 * to keep it in.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { initializeApp, getApp, getApps, type FirebaseApp } from "firebase/app"
import {
  GoogleAuthProvider,
  browserPopupRedirectResolver,
  inMemoryPersistence,
  initializeAuth,
  signInAnonymously,
  signInWithPopup,
  type Auth,
  type UserCredential,
} from "firebase/auth"
import { RiGoogleFill, RiLoader4Line, RiUserLine } from "@remixicon/react"

import type { FirebaseClientConfig } from "@/lib/firebase-config"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

const APP_NAME = "drift-dashboard"

let cached: Auth | null = null

function clientAuth(config: FirebaseClientConfig): Auth {
  if (cached) return cached

  const existing = getApps().find((app) => app.name === APP_NAME)
  const app: FirebaseApp = existing
    ? getApp(APP_NAME)
    : initializeApp(config, APP_NAME)

  // `initializeAuth` rather than `getAuth`, because it is the only way to say
  // what persistence to use before the SDK reaches for IndexedDB. The popup
  // resolver has to be named explicitly when auth is initialised this way.
  cached = initializeAuth(app, {
    persistence: inMemoryPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  })
  return cached
}

type Method = "google" | "anonymous"

export function SignIn({
  config,
  allowAnonymous,
}: {
  config: FirebaseClientConfig
  /**
   * Whether to offer the anonymous button. Development only: an anonymous
   * session can resolve findings and open pull requests against the watched
   * repo, so it must never be reachable on a deployed origin.
   */
  allowAnonymous: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = React.useState<Method | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function signIn(method: Method) {
    setPending(method)
    setError(null)

    try {
      const auth = clientAuth(config)
      const credential: UserCredential =
        method === "google"
          ? await signInWithPopup(auth, new GoogleAuthProvider())
          : await signInAnonymously(auth)

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
      setPending(null)
    }
  }

  const busy = pending !== null

  return (
    <div className="flex flex-col gap-3">
      <Button onClick={() => signIn("google")} disabled={busy} size="lg">
        {pending === "google" ? (
          <RiLoader4Line className="animate-spin" data-icon="inline-start" />
        ) : (
          <RiGoogleFill data-icon="inline-start" />
        )}
        {pending === "google" ? "Signing in" : "Continue with Google"}
      </Button>

      {allowAnonymous ? (
        <>
          <Button
            onClick={() => signIn("anonymous")}
            disabled={busy}
            size="lg"
            variant="outline"
          >
            {pending === "anonymous" ? (
              <RiLoader4Line
                className="animate-spin"
                data-icon="inline-start"
              />
            ) : (
              <RiUserLine data-icon="inline-start" />
            )}
            {pending === "anonymous"
              ? "Signing in"
              : "Continue without an account"}
          </Button>

          <p className="text-xs leading-relaxed text-muted-foreground">
            An anonymous session can resolve findings and open pull requests
            against the watched repo, so this button is only built in
            development. AGENTS.md section 1 says Google only; take it out once
            Google sign-in works.
          </p>
        </>
      ) : null}

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
