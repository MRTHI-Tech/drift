import type { Firestore } from "firebase-admin/firestore"

import { COLLECTIONS } from "../constants"
import type { Run } from "../types"
import { createBaseRepository, readAll, type BaseRepository } from "./base"

export interface RunRepository extends BaseRepository<Run> {
  /** Runs for one project, newest first. */
  listByProject(projectId: string, limit?: number): Promise<Run[]>
  /** The most recent run for a project, or null when it has never run. */
  latestForProject(projectId: string): Promise<Run | null>
}

export function createRunRepository(db: Firestore): RunRepository {
  const base = createBaseRepository<Run>(db, COLLECTIONS.runs)

  const byProject = (projectId: string) =>
    base.collection.where("projectId", "==", projectId).orderBy("startedAt", "desc")

  return {
    ...base,

    async listByProject(projectId, limit = 50) {
      return readAll<Run>(byProject(projectId).limit(limit))
    },

    async latestForProject(projectId) {
      const runs = await readAll<Run>(byProject(projectId).limit(1))
      return runs[0] ?? null
    },
  }
}
