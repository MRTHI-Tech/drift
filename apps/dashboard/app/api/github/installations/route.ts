/**
 * What the GitHub App can reach, asked of GitHub every time.
 *
 * Nothing here is stored. An installation is a grant a person made on GitHub
 * and can withdraw there without telling Drift, so a cached copy would be
 * wrong exactly when it mattered (AGENTS.md section 2). The dialog asks on
 * open, and again when somebody comes back from installing.
 *
 * A deployment with no app configured is not an error. It answers
 * `configured: false`, and the dialog falls back to a typed repo on the
 * personal access token, which is what every project before the app was on.
 */

import { appInstallUrl, errorMessage, githubAppConfig, listAppInstallations } from "@drift/core"

import { requireApiSession } from "@/lib/session"

// firebase-admin and Octokit both need Node, not the edge runtime.
export const runtime = "nodejs"

export async function GET(): Promise<Response> {
  const gate = await requireApiSession()
  if (gate.response) return gate.response

  const config = githubAppConfig()
  if (!config) {
    return Response.json({ configured: false, installUrl: null, installations: [] })
  }

  try {
    const [installUrl, installations] = await Promise.all([
      appInstallUrl(config),
      listAppInstallations(config),
    ])
    return Response.json({ configured: true, installUrl, installations })
  } catch (error) {
    // The app is configured but GitHub would not answer: about this deployment
    // rather than about anything somebody typed.
    return Response.json({ error: errorMessage(error) }, { status: 500 })
  }
}
