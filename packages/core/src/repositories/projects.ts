import type { Firestore } from "firebase-admin/firestore"

import { COLLECTIONS } from "../constants"
import type { Project } from "../types"
import { createBaseRepository, readAll, type BaseRepository } from "./base"

export interface ProjectRepository extends BaseRepository<Project> {
  /** Every watched project, oldest first. The only collection not scoped by project. */
  list(): Promise<Project[]>
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

    async findByRepo(repo) {
      const matches = await readAll<Project>(base.collection.where("repo", "==", repo).limit(1))
      return matches[0] ?? null
    },
  }
}
