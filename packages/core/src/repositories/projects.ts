import type { Firestore } from "firebase-admin/firestore"

import { COLLECTIONS } from "../constants"
import type { Project } from "../types"
import { createBaseRepository, readAll, type BaseRepository } from "./base"

export interface ProjectRepository extends BaseRepository<Project> {
  /**
   * Every watched project, oldest first, across every account.
   *
   * The worker, the scheduler and the deploy webhook use this: they run below
   * the session and act on a project they were handed by id. Nothing the
   * dashboard renders may call it — a signed-in person sees `listForUser`.
   */
  list(): Promise<Project[]>
  /** Every project this person created, oldest first. */
  listForUser(userId: string): Promise<Project[]>
  /** The project watching a given `owner/name` repo, or null. */
  findByRepo(repo: string): Promise<Project | null>
}

export function createProjectRepository(db: Firestore): ProjectRepository {
  const base = createBaseRepository<Project>(db, COLLECTIONS.projects)

  return {
    ...base,

    async list() {
      return readAll<Project>(base.collection.orderBy("createdAt", "asc"))
    },

    async listForUser(userId) {
      return readAll<Project>(
        base.collection.where("userId", "==", userId).orderBy("createdAt", "asc"),
      )
    },

    async findByRepo(repo) {
      const matches = await readAll<Project>(base.collection.where("repo", "==", repo).limit(1))
      return matches[0] ?? null
    },
  }
}
