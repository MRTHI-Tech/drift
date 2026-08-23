import type { Firestore } from "firebase-admin/firestore"

import { isComponentProperty } from "../analysis/components"
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

    /**
     * Two floors, because there are two units.
     *
     * A screen convention counts screens, and three of them have to agree
     * before it exists at all (AGENTS.md section 2). A component convention
     * counts instances, and its floor is three of those, enforced where the
     * counting happens because that is the only place the number exists. Four
     * buttons agreeing across two screens is real evidence about buttons, and
     * a guard written in screens would refuse it.
     *
     * So what is checked here is the one thing that holds for both: a
     * convention nothing was measured on is not a convention.
     */
    async create(input: NewEntity<Convention>, id?: string) {
      const component = isComponentProperty(input.property)
      const floor = component ? 1 : MIN_SCREENS_PER_CONVENTION

      if (input.evidenceScreenIds.length < floor) {
        const unit = component
          ? "a screen to have been measured on"
          : `${MIN_SCREENS_PER_CONVENTION} or more agreeing screens`
        throw new Error(
          `A convention needs ${unit}. ` +
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
