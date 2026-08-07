/**
 * Every route except `/login` requires a session (AGENTS.md section 1).
 *
 * This is the optimistic check the Next.js authentication guide describes: it
 * asks whether the session cookie is there and sends anyone without one to the
 * login page, so a signed-out person never waits for a page they cannot see.
 * It deliberately does not verify the cookie. Verification is `requireSession`
 * in front of every page and `requireApiSession` in front of every route
 * handler, both of which run on the server against Firebase, and a forged
 * cookie gets past this file and stops there.
 */

import { NextResponse, type NextRequest } from "next/server"

import { SESSION_COOKIE } from "@/lib/session"

/** Paths reachable without a session. */
const PUBLIC_PATHS = ["/login", "/api/auth/session"]

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl

  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  )
  const hasCookie = request.cookies.has(SESSION_COOKIE)

  if (isPublic) {
    // Somebody already signed in has no reason to see the login page.
    if (pathname === "/login" && hasCookie) {
      return NextResponse.redirect(new URL("/runs", request.url))
    }
    return NextResponse.next()
  }

  if (hasCookie) return NextResponse.next()

  // An API call answers with a 401 rather than a redirect: a fetch that follows
  // a redirect to an HTML page reports a confusing failure.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in to do that." }, { status: 401 })
  }

  return NextResponse.redirect(new URL("/login", request.url))
}

export const config = {
  // Everything except the framework's own assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
