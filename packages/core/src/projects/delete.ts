/**
 * Removing a project, and everything that only existed because of it.
 *
 * This is one of the two deletions in Drift (AGENTS.md section 2), and the only
 * one that reaches more than a single document. It is destructive and it is not
 * reversible, so three things hold.
 *
 * **It counts before it asks.** What is about to be lost is stated exactly, the
 * way every other number in this product is: measured, not estimated. Somebody
 * deciding whether to remove a project should be reading "63 findings, 23
 * resolutions" rather than "all associated data".
 *
 * **It is confirmed by name.** The project's own name, typed. A button alone is
 * a thing a person can press by accident, and there is nothing behind this one
 * to undo it.
 *
 * **It erases in a recoverable order**: screenshots, then the collections, then
 * the project document last. The project is the index into everything else, so
 * a cascade that fails part way leaves a project that can simply be removed
 * again. The other order leaves documents nothing can reach, because every query
 * in Drift is scoped by `projectId` and there would be no project to scope by.
 */

import { COLLECTIONS } from "../constants"
import { getDriftFirestore } from "../firestore"
import { createLogger, type Logger } from "../logging"
import type { Repositories } from "../repositories"
import { deleteProjectScreenshots } from "../storage"
import type { Project } from "../types"

/** Collections that carry a `projectId` and are removed with their project. */
export const OWNED_COLLECTIONS = [
  COLLECTIONS.runs,
  COLLECTIONS.screens,
  COLLECTIONS.archetypes,
  COLLECTIONS.conventions,
  COLLECTIONS.findings,
  COLLECTIONS.resolutions,
] as const

export type OwnedCollection = (typeof OWNED_COLLECTIONS)[number]

/** What a project owns, counted. Screenshots are objects, not documents. */
export type ProjectContents = Record<OwnedCollection, number> & { screenshots: number }

/** Raised when the project asked about is not there. */
export class ProjectNotFoundError extends Error {
  override readonly name = "ProjectNotFoundError"
}

/** Raised when the typed name does not match the project's own. */
export class ProjectConfirmationError extends Error {
  override readonly name = "ProjectConfirmationError"
}

/**
 * The three destructive steps, behind an interface so the order they run in is
 * a thing a test can watch rather than a thing a comment claims.
 */
export interface ProjectEraser {
  count(projectId: string): Promise<ProjectContents>
  eraseScreenshots(projectId: string): Promise<number>
  /** Deletes every document of one collection that carries this projectId. */
  eraseCollection(projectId: string, collection: OwnedCollection): Promise<number>
  eraseProject(projectId: string): Promise<void>
}

export interface DeleteProjectInput {
  projectId: string
  /** The project's name, as the person typed it. Must match exactly. */
  confirmName: string
  repositories: Repositories
  eraser?: ProjectEraser
  logger?: Logger
}

export interface DeleteProjectResult {
  projectId: string
  name: string
  repo: string
  /** What was actually removed, counted as it went. */
  deleted: ProjectContents
}

/** Why the typed name is not the project's, or null when it is. */
export function confirmationProblem(project: Project, typed: string): string | null {
  if (typed.trim() === project.name.trim()) return null
  return `Type ${project.name} to remove it. This cannot be undone.`
}

/** Removes a project and everything scoped to it. */
export async function deleteProject(input: DeleteProjectInput): Promise<DeleteProjectResult> {
  const { projectId, confirmName, repositories } = input
  const eraser = input.eraser ?? firestoreEraser()
  const logger = (input.logger ?? createLogger()).child({ projectId })

  const project = await repositories.projects.get(projectId)
  if (!project) {
    throw new ProjectNotFoundError(`No project with id ${projectId}.`)
  }

  const problem = confirmationProblem(project, confirmName)
  if (problem) throw new ProjectConfirmationError(problem)

  const counted = await eraser.count(projectId)
  logger.log("project.delete_started", {
    name: project.name,
    repo: project.repo,
    ...counted,
  })

  const deleted: ProjectContents = { ...counted, screenshots: 0 }

  // Images first. They are reachable by prefix without any document, so they
  // are the one thing that can be cleaned up even if everything else fails.
  deleted.screenshots = await eraser.eraseScreenshots(projectId)

  for (const collection of OWNED_COLLECTIONS) {
    deleted[collection] = await eraser.eraseCollection(projectId, collection)
  }

  // Last, because it is the index into all of the above.
  await eraser.eraseProject(projectId)

  logger.log("project.deleted", {
    name: project.name,
    repo: project.repo,
    ...deleted,
  })

  return { projectId, name: project.name, repo: project.repo, deleted }
}

/** Counts what a project owns, without removing any of it. */
export async function countProjectContents(
  projectId: string,
  eraser: ProjectEraser = firestoreEraser(),
): Promise<ProjectContents> {
  return eraser.count(projectId)
}

/** Most documents deleted in one batch. Firestore's own limit is 500. */
const BATCH_SIZE = 300

/** The real one: Firestore for the documents, Cloud Storage for the images. */
export function firestoreEraser(db = getDriftFirestore()): ProjectEraser {
  const owned = (projectId: string, collection: OwnedCollection) =>
    db.collection(collection).where("projectId", "==", projectId)

  return {
    async count(projectId) {
      const counts = {} as Record<OwnedCollection, number>

      for (const collection of OWNED_COLLECTIONS) {
        // An aggregation rather than a read: the number is all that is wanted,
        // and a project with thousands of screens should not be pulled into
        // memory to be counted.
        const snapshot = await owned(projectId, collection).count().get()
        counts[collection] = snapshot.data().count
      }

      return { ...counts, screenshots: 0 }
    },

    async eraseScreenshots(projectId) {
      return deleteProjectScreenshots(projectId)
    },

    async eraseCollection(projectId, collection) {
      let removed = 0

      // Paged rather than read whole: the query is re-run each time because the
      // documents it matched are gone, so it always returns the next batch.
      for (;;) {
        const page = await owned(projectId, collection).limit(BATCH_SIZE).get()
        if (page.empty) break

        const batch = db.batch()
        for (const doc of page.docs) batch.delete(doc.ref)
        await batch.commit()

        removed += page.size
        if (page.size < BATCH_SIZE) break
      }

      return removed
    },

    async eraseProject(projectId) {
      await db.collection(COLLECTIONS.projects).doc(projectId).delete()
    },
  }
}
