import type { Firestore } from "firebase-admin/firestore"

import { COLLECTIONS, MIN_SCREENS_PER_CONVENTION } from "../constants"
import type { Convention } from "../types"
import { createBaseRepository, readAll, type BaseRepository } from "./base"
import type { NewEntity } from "./document"

export interface ConventionRepository extends BaseRepository<Convention> {
  /** Every convention for one project, most recently updated first. */
  listByProject(projectId: string): Promise<Convention[]>
  /** Conventions scoped to one archetype. */
  listByArchetype(projectId: string, archetypeId: string): Promise<Convention[]>
  /** Product-wide conventions, the ones with no archetype. */
  listProductWide(projectId: string): Promise<Convention[]>
  /**
   * The convention an archetype already holds for one property, or null. One
   * archetype states a property once, so re-deriving updates that document
   * rather than stacking a second opinion beside it.
   */
  findByProperty(
    projectId: string,
    archetypeId: string | null,
    property: string,
  ): Promise<Convention | null>
  /**
   * Hard-deletes a convention. This is the only hard delete in Drift and is
   * reserved for an explicit user action on the conventions page
   * (AGENTS.md section 2).
   */
  remove(id: string): Promise<void>
}

export function createConventionRepository(db: Firestore): ConventionRepository {
  const base = createBaseRepository<Convention>(db, COLLECTIONS.conventions)

  const inProject = (projectId: string) => base.collection.where("projectId", "==", projectId)

  return {
    ...base,

    async create(input: NewEntity<Convention>, id?: string) {
      if (input.evidenceScreenIds.length < MIN_SCREENS_PER_CONVENTION) {
        throw new Error(
          `A convention needs ${MIN_SCREENS_PER_CONVENTION} or more agreeing screens. ` +
            `Got ${input.evidenceScreenIds.length} for ${input.property}.`,
        )
      }
      return base.create(input, id)
    },

    async listByProject(projectId) {
      return readAll<Convention>(inProject(projectId).orderBy("updatedAt", "desc"))
    },

    async listByArchetype(projectId, archetypeId) {
      return readAll<Convention>(inProject(projectId).where("archetypeId", "==", archetypeId))
    },

    async listProductWide(projectId) {
      return readAll<Convention>(inProject(projectId).where("archetypeId", "==", null))
    },

    async findByProperty(projectId, archetypeId, property) {
      const matches = await readAll<Convention>(
        inProject(projectId)
          .where("archetypeId", "==", archetypeId)
          .where("property", "==", property)
          .limit(1),
      )
      return matches[0] ?? null
    },

    async remove(id) {
      await base.collection.doc(id).delete()
    },
  }
}
