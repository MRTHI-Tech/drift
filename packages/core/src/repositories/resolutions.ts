import type { Firestore } from "firebase-admin/firestore"

import { COLLECTIONS } from "../constants"
import type { Resolution } from "../types"
import { createBaseRepository, readAll } from "./base"
import type { NewEntity } from "./document"

/**
 * Resolutions are append-only and never deleted (AGENTS.md section 2), so this
 * repository deliberately exposes no update and no delete.
 */
export interface ResolutionRepository {
  create(input: NewEntity<Resolution>, id?: string): Promise<Resolution>
  get(id: string): Promise<Resolution | null>
  /** The resolution history of one finding, oldest first. */
  listByFinding(projectId: string, findingId: string): Promise<Resolution[]>
  /** Every resolution in one project, newest first. */
  listByProject(projectId: string, limit?: number): Promise<Resolution[]>
}

export function createResolutionRepository(db: Firestore): ResolutionRepository {
  const base = createBaseRepository<Resolution>(db, COLLECTIONS.resolutions)

  const inProject = (projectId: string) => base.collection.where("projectId", "==", projectId)

  return {
    create: base.create,
    get: base.get,

    async listByFinding(projectId, findingId) {
      return readAll<Resolution>(
        inProject(projectId).where("findingId", "==", findingId).orderBy("createdAt", "asc"),
      )
    },

    async listByProject(projectId, limit = 100) {
      return readAll<Resolution>(inProject(projectId).orderBy("createdAt", "desc").limit(limit))
    },
  }
}
