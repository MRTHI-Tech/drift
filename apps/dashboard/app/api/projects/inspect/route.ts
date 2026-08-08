/**
 * What Drift knows about a repo before it agrees to watch it.
 *
 * Reads only: the repo's metadata, its `drift.config.json`, its token file, and
 * one request to the preview. Nothing here writes to GitHub or to Firestore, so
 * the dialog can call it on every edit of the repo field without consequence.
 */

import { errorMessage } from "@drift/core"

import { inspectRepo, readProjectBody, repoRejection } from "@/lib/projects"
import { requireApiSession } from "@/lib/session"

// firebase-admin and Octokit both need Node, not the edge runtime.
export const runtime = "nodejs"

export async function POST(request: Request): Promise<Response> {
  const gate = await requireApiSession()
  if (gate.response) return gate.response

  const body = await readProjectBody(request)

  const rejected = repoRejection(body)
  if (rejected) return rejected

  try {
    return Response.json(await inspectRepo(body))
  } catch (error) {
    // GITHUB_TOKEN missing, or GitHub unreachable. Both are about this
    // deployment rather than about the repo somebody typed.
    return Response.json({ error: errorMessage(error) }, { status: 500 })
  }
}
