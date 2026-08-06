import type { Firestore } from "firebase-admin/firestore"

import { COLLECTIONS } from "../constants"
import type { Finding, FindingStatus } from "../types"
import { createBaseRepository, readAll, type BaseRepository } from "./base"
import type { NewEntity } from "./document"

/** What `createIfNew` did: a fresh finding, or the one that already covers it. */
export interface FindingWriteResult {
  created: boolean
  finding: Finding
}

export interface FindingRepository extends BaseRepository<Finding> {
  /** Findings for one project, newest first. */
  listByProject(projectId: string, limit?: number): Promise<Finding[]>
  /** Unresolved findings for one project, newest first. */
  listOpen(projectId: string, limit?: number): Promise<Finding[]>
  /** Findings raised by one run. */
  listByRun(projectId: string, runId: string): Promise<Finding[]>
  /** The existing finding carrying a dedupe key, or null. */
  findByDedupeKey(projectId: string, dedupeKey: string): Promise<Finding | null>
  /**
   * Writes a finding unless one with the same dedupeKey already exists.
   * Findings are never deleted, so an existing document of any status stands.
   */
  createIfNew(input: NewEntity<Finding>): Promise<FindingWriteResult>
  /** Moves a finding to a new status, stamping or clearing `resolvedAt`. */
  setStatus(id: string, status: FindingStatus, at?: Date): Promise<Finding>
}

export function createFindingRepository(db: Firestore): FindingRepository {
  const base = createBaseRepository<Finding>(db, COLLECTIONS.findings)

  const inProject = (projectId: string) => base.collection.where("projectId", "==", projectId)

  const repository: FindingRepository = {
    ...base,

    async listByProject(projectId, limit = 100) {
      return readAll<Finding>(inProject(projectId).orderBy("createdAt", "desc").limit(limit))
    },

    async listOpen(projectId, limit = 100) {
      return readAll<Finding>(
        inProject(projectId)
          .where("status", "==", "open" satisfies FindingStatus)
          .orderBy("createdAt", "desc")
          .limit(limit),
      )
    },

    async listByRun(projectId, runId) {
      return readAll<Finding>(inProject(projectId).where("runId", "==", runId))
    },

    async findByDedupeKey(projectId, dedupeKey) {
      const matches = await readAll<Finding>(
        inProject(projectId).where("dedupeKey", "==", dedupeKey).limit(1),
      )
      return matches[0] ?? null
    },

    async createIfNew(input) {
      const existing = await repository.findByDedupeKey(input.projectId, input.dedupeKey)
      if (existing) return { created: false, finding: existing }
      return { created: true, finding: await base.create(input) }
    },

    async setStatus(id, status, at = new Date()) {
      return base.update(id, { status, resolvedAt: status === "open" ? null : at })
    },
  }

  return repository
}
