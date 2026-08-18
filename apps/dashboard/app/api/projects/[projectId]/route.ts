/**
 * What a project owns, and removing it.
 *
 * `GET` counts. `DELETE` removes, and takes the project's name in the body
 * because a button is a thing somebody can press by accident and there is
 * nothing behind this one to undo it.
 *
 * Both are behind the session. Removing a project is one of the two deletions
 * in Drift (AGENTS.md section 2) and by far the larger, so the gate is the
 * first thing either handler does.
 */

import {
  countProjectContents,
  createRepositories,
  createLogger,
  deleteProject,
  errorMessage,
  ProjectConfirmationError,
  ProjectNotFoundError,
} from "@drift/core"

import { apiOwner, notYours, ownedProject } from "@/lib/ownership"

// firebase-admin needs Node, not the edge runtime.
export const runtime = "nodejs"

interface ProjectParams {
  params: Promise<{ projectId: string }>
}

export async function GET(_request: Request, context: ProjectParams): Promise<Response> {
  const gate = await apiOwner()
  if (gate.response) return gate.response

  const { projectId } = await context.params

  try {
    const project = await ownedProject(projectId, gate.userId, gate.repositories)
    if (!project) return notYours()

    return Response.json({
      projectId: project.id,
      name: project.name,
      repo: project.repo,
      contents: await countProjectContents(projectId),
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 })
  }
}

export async function DELETE(request: Request, context: ProjectParams): Promise<Response> {
  const gate = await apiOwner()
  if (gate.response) return gate.response

  const { projectId } = await context.params
  const confirmName = await readConfirmation(request)

  // The most destructive thing in Drift: runs, screens, archetypes,
  // conventions, findings, resolutions, and every screenshot in the bucket.
  // Ownership is checked before the name is even compared.
  if (!(await ownedProject(projectId, gate.userId, gate.repositories))) {
    return notYours()
  }

  try {
    const result = await deleteProject({
      projectId,
      confirmName,
      repositories: gate.repositories,
      logger: createLogger(),
    })
    return Response.json(result)
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof ProjectConfirmationError) {
      return Response.json({ error: error.message, field: "confirmName" }, { status: 400 })
    }
    return Response.json({ error: errorMessage(error) }, { status: 500 })
  }
}

/** The typed name, or an empty string, which `deleteProject` will refuse. */
async function readConfirmation(request: Request): Promise<string> {
  try {
    const value: unknown = await request.json()
    if (typeof value !== "object" || value === null) return ""
    const typed = (value as Record<string, unknown>).confirmName
    return typeof typed === "string" ? typed : ""
  } catch {
    return ""
  }
}
