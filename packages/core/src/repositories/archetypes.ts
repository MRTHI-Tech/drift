import type { Firestore } from "firebase-admin/firestore"

import { COLLECTIONS } from "../constants"
import type { Archetype } from "../types"
import { createBaseRepository, readAll, type BaseRepository } from "./base"

export interface ArchetypeRepository extends BaseRepository<Archetype> {
  /** Every archetype for one project, oldest first. */
  listByProject(projectId: string): Promise<Archetype[]>
}

export function createArchetypeRepository(db: Firestore): ArchetypeRepository {
  const base = createBaseRepository<Archetype>(db, COLLECTIONS.archetypes)

  return {
    ...base,

    async listByProject(projectId) {
      return readAll<Archetype>(
        base.collection.where("projectId", "==", projectId).orderBy("createdAt", "asc"),
      )
    },
  }
}
