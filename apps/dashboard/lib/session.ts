/**
 * The session gate. Firebase Auth, Google provider, one user (AGENTS.md
 * section 1).
 *
 * The browser signs in with the Firebase client SDK and gets an ID token that
 * lasts an hour. That token is exchanged once, at `/api/auth/session`, for a
 * session cookie the Admin SDK minted, and the cookie is what every later
 * request carries: httpOnly, so no script can read it, and verified on the
 * server on every request that matters rather than trusted because it is there.
 *
 * `proxy.ts` only checks that the cookie exists, which is an optimistic check
 * and is not the gate. The gate is `requireSession` in front of every page and
 * `requireApiSession` in front of every route handler, both of which verify the
 * cookie against Firebase and both of which run on the server.
 */

import { getDriftApp } from "@drift/core"
import { getAuth, type DecodedIdToken } from "firebase-admin/auth"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

/** Name of the session cookie. Referenced by `proxy.ts` as well. */
export const SESSION_COOKIE = "drift_session"

/**
 * How long a session lasts before the person signs in again. Five days is the
 * Firebase maximum for a session cookie; a dashboard that opens pull requests
 * against somebody's repository should not hold a session longer than that.
 */
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000

/** Who is signed in. Only what the interface shows; no roles (AGENTS.md section 1). */
export interface Session {
  uid: string
  email: string | null
  name: string | null
  picture: string | null
}

/** Firebase Auth on the same app Firestore and Cloud Storage run against. */
function driftAuth() {
  return getAuth(getDriftApp())
}

/** Exchanges a freshly minted ID token for a session cookie. */
export async function mintSessionCookie(idToken: string): Promise<string> {
  return driftAuth().createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_MS,
  })
}

/**
 * Who this request is, or null. Verifies the cookie against Firebase every
 * time, with revocation checked, so signing out of Firebase ends the session
 * here too rather than at the cookie's own expiry.
 */
export async function readSession(): Promise<Session | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value
  if (!cookie) return null

  try {
    return present(await driftAuth().verifySessionCookie(cookie, true))
  } catch {
    // An expired, revoked, or tampered cookie is not an error to report. It is
    // somebody who needs to sign in again.
    return null
  }
}

/** The session, or the login page. What every protected page calls first. */
export async function requireSession(): Promise<Session> {
  const session = await readSession()
  if (!session) redirect("/login")
  return session
}

/**
 * The session, or a 401. What every route handler calls first, including the
 * four resolution routes, which write to Firestore and open pull requests.
 */
export async function requireApiSession(): Promise<
  { session: Session; response: null } | { session: null; response: Response }
> {
  const session = await readSession()
  if (session) return { session, response: null }

  return {
    session: null,
    response: Response.json({ error: "Sign in to do that." }, { status: 401 }),
  }
}

function present(token: DecodedIdToken): Session {
  return {
    uid: token.uid,
    email: typeof token.email === "string" ? token.email : null,
    name: typeof token.name === "string" ? token.name : null,
    picture: typeof token.picture === "string" ? token.picture : null,
  }
}
