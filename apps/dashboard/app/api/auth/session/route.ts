/**
 * The two ends of a session.
 *
 * POST takes the ID token the browser got from Firebase and answers with an
 * httpOnly session cookie. It is the only route reachable without a session,
 * and it verifies the token before it mints anything, so the cookie can never
 * say more than Firebase already said.
 *
 * DELETE drops the cookie. It does not revoke the refresh token: signing out of
 * this dashboard should not sign the person out of Google everywhere.
 */

import { createLogger, errorMessage } from "@drift/core"
import { cookies } from "next/headers"

import {
  mintSessionCookie,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
} from "@/lib/session"

// firebase-admin needs Node, not the edge runtime.
export const runtime = "nodejs"

export async function POST(request: Request): Promise<Response> {
  const idToken = await readIdToken(request)
  if (!idToken) {
    return Response.json(
      { error: "That sign-in carried no token." },
      { status: 400 }
    )
  }

  let cookie: string
  try {
    cookie = await mintSessionCookie(idToken)
  } catch (error) {
    // Vague to the caller: what exactly was wrong with a token is not something
    // to tell whoever sent it. Specific in the log, because a sign-in that
    // fails for a configuration reason is otherwise undebuggable. Through the
    // shared logger so Cloud Logging lifts it into `jsonPayload` and it is
    // queryable beside everything a run writes (AGENTS.md section 7), and
    // never the token.
    createLogger().error("auth.session_rejected", {
      message: errorMessage(error),
      code: readErrorCode(error),
    })
    return Response.json(
      { error: "That sign-in was not accepted." },
      { status: 401 }
    )
  }

  const store = await cookies()
  store.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_MS / 1000,
  })

  return Response.json({ signedIn: true })
}

export async function DELETE(): Promise<Response> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
  return Response.json({ signedIn: false })
}

async function readIdToken(request: Request): Promise<string | null> {
  try {
    const value: unknown = await request.json()
    if (typeof value !== "object" || value === null) return null

    const token = (value as Record<string, unknown>).idToken
    return typeof token === "string" && token.length > 0 ? token : null
  } catch {
    return null
  }
}

/** The Firebase Admin error code, when the failure carries one. */
function readErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null
  const code = (error as Record<string, unknown>).code
  return typeof code === "string" ? code : null
}
