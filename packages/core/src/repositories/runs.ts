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

/**
 * A run as stored, with `knownFindings` filled in when the document predates
 * the field. Firestore returns what was written and nothing more, so a run
 * from before the field existed comes back missing it while the type promises
 * a number or a null. Null is the honest answer for those: nobody counted.
 */
function hydrate(run: Run): Run {
  return { ...run, knownFindings: run.knownFindings ?? null }
}

export function createRunRepository(db: Firestore): RunRepository {
  const base = createBaseRepository<Run>(db, COLLECTIONS.runs)

  const byProject = (projectId: string) =>
    base.collection.where("projectId", "==", projectId).orderBy("startedAt", "desc")

  return {
    ...base,

    async get(id) {
      const run = await base.get(id)
      return run ? hydrate(run) : null
    },

    async listByProject(projectId, limit = 50) {
      return (await readAll<Run>(byProject(projectId).limit(limit))).map(hydrate)
    },

    async latestForProject(projectId) {
      const runs = await readAll<Run>(byProject(projectId).limit(1))
      return runs[0] ? hydrate(runs[0]) : null
    },
  }
}
