import "server-only"

/**
 * The second lock.
 *
 * Every route and every page already asks whether somebody is signed in. This
 * asks the other question: is this theirs. Both are needed, and only one of
 * them was here.
 *
 * The reason it is one file rather than a check written into each handler is
 * that a missed check is invisible. Nothing looks wrong, no test fails, and
 * the only way to find out is for somebody to read a document that was not
 * theirs. So every door goes through these three functions, and
 * `ownership.test.ts` greps the routes to prove none of them stopped.
 *
 * Drift never decides who owns a repo (AGENTS.md section 9). GitHub decided
 * that when the app was installed, and the picker only ever offers what an
 * installation grants. What is checked here is narrower and is the only claim
 * Drift makes: this project document records the uid that created it.
 */

import { createRepositories, type Project, type Repositories } from "@drift/core"

import { requireApiSession, requireSession } from "@/lib/session"

/** Raised for anything that is not this person's. Never says what it was. */
export class NotYours extends Error {
  override readonly name = "NotYours"
}

/**
 * A project this person owns, or null.
 *
 * Null for a project that does not exist and null for one belonging to
 * somebody else, deliberately the same answer. Telling the two apart tells a
 * stranger which ids are real.
 */
export async function ownedProject(
  projectId: string,
  userId: string,
  repositories: Repositories = createRepositories(),
): Promise<Project | null> {
  const project = await repositories.projects.get(projectId)
  if (!project) return null
  return project.userId === userId ? project : null
}

/**
 * The project behind something that carries a `projectId`: a finding, a
 * convention, a screen, a run. Every one of those hangs off a project, which
 * is why one field on `projects` is enough to scope the whole schema.
 */
export async function ownedVia(
  owner: { projectId: string } | null,
  userId: string,
  repositories: Repositories = createRepositories(),
): Promise<Project | null> {
  if (!owner) return null
  return ownedProject(owner.projectId, userId, repositories)
}

/** For pages. Throws `NotYours`, which the segment turns into a not-found. */
export async function requireOwnedProject(projectId: string): Promise<Project> {
  const session = await requireSession()
  const project = await ownedProject(projectId, session.uid)
  if (!project) throw new NotYours(`No project ${projectId}.`)
  return project
}

/**
 * For route handlers. Answers with the session and the repositories when it
 * passes, and with the response to return when it does not.
 *
 * The 404 is the same shape whether the thing is missing or is somebody
 * else's, for the reason above.
 */
export async function apiOwner(): Promise<
  | { userId: string; repositories: Repositories; response: null }
  | { userId: null; repositories: null; response: Response }
> {
  const gate = await requireApiSession()
  if (gate.response) return { userId: null, repositories: null, response: gate.response }

  return {
    userId: gate.session.uid,
    repositories: createRepositories(),
    response: null,
  }
}

/** The one answer for anything not this person's. */
export function notYours(): Response {
  return Response.json({ error: "There is no such thing here." }, { status: 404 })
}
