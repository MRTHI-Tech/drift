/**
 * Where GitHub sends somebody back after they install the app.
 *
 * This is the app's Setup URL. GitHub appends `installation_id` and
 * `setup_action`, and this hands both to the dashboard so the add-project
 * dialog can reopen on the installation that was just made.
 *
 * It deliberately stores nothing. The installation is recorded on a project
 * when a project is created from it, and until then the only record of it is
 * GitHub's, which is the one that stays true (AGENTS.md section 2). So this
 * route is a redirect and a sanity check, not a write.
 *
 * It is session-gated like every other route except the Pub/Sub push. GitHub
 * sends the person's own browser here, so the cookie rides along; a request
 * without one is somebody else following a link.
 */

import { NextResponse } from "next/server"

import { githubAppConfig, listAppInstallations } from "@drift/core"

import { readSession } from "@/lib/session"

// firebase-admin and Octokit both need Node, not the edge runtime.
export const runtime = "nodejs"

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const home = new URL("/", url.origin)

  const session = await readSession()
  if (!session) {
    // Straight to sign-in, keeping where they were going. Coming back from
    // GitHub without a session means the cookie expired while they were away.
    const login = new URL("/login", url.origin)
    login.searchParams.set("next", `${url.pathname}${url.search}`)
    return NextResponse.redirect(login)
  }

  const raw = url.searchParams.get("installation_id")
  const installationId = raw && /^\d+$/.test(raw) ? Number(raw) : null

  if (installationId === null) {
    home.searchParams.set("github", "no_installation")
    return NextResponse.redirect(home)
  }

  // Confirm with GitHub that this installation is really one of ours before
  // the dialog offers its repos. The id arrives in a query string, and a query
  // string is something anybody can write.
  const config = githubAppConfig()
  if (!config) {
    home.searchParams.set("github", "not_configured")
    return NextResponse.redirect(home)
  }

  try {
    const installations = await listAppInstallations(config)
    if (!installations.some((installation) => installation.id === installationId)) {
      home.searchParams.set("github", "unknown_installation")
      return NextResponse.redirect(home)
    }
  } catch {
    home.searchParams.set("github", "unreachable")
    return NextResponse.redirect(home)
  }

  home.searchParams.set("github", "connected")
  home.searchParams.set("installation_id", String(installationId))
  return NextResponse.redirect(home)
}
