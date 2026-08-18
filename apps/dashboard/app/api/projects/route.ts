/**
 * Starting to watch a project.
 *
 * Writes one `projects` document through `createProject` in `@drift/core`, the
 * same function `pnpm seed` calls, then opens the config pull request if one
 * was asked for and starts the first run. The project is the deliverable; the
 * other two report what they did rather than failing the request.
 */

import { createWatchedProject, creationFailure, readProjectBody, repoRejection } from "@/lib/projects"
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
    return Response.json(await createWatchedProject(body, gate.session.uid))
  } catch (error) {
    return creationFailure(error)
  }
}
