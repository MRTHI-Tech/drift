import type { Firestore } from "firebase-admin/firestore"

import { COLLECTIONS } from "../constants"
import type { Screen, Viewport } from "../types"
import { createBaseRepository, readAll, type BaseRepository } from "./base"

export interface ScreenRepository extends BaseRepository<Screen> {
  /** Every screen captured by one run. */
  listByRun(projectId: string, runId: string): Promise<Screen[]>
  /** The history of one route at one viewport, newest capture first. */
  listByRoute(projectId: string, route: string, viewport: Viewport, limit?: number): Promise<Screen[]>
  /** Sibling screens: everything classified into the same archetype. */
  listByArchetype(projectId: string, archetypeId: string): Promise<Screen[]>
}

export function createScreenRepository(db: Firestore): ScreenRepository {
  const base = createBaseRepository<Screen>(db, COLLECTIONS.screens)

  const inProject = (projectId: string) => base.collection.where("projectId", "==", projectId)

  return {
    ...base,

    async listByRun(projectId, runId) {
      return readAll<Screen>(inProject(projectId).where("runId", "==", runId))
    },

    async listByRoute(projectId, route, viewport, limit = 20) {
      return readAll<Screen>(
        inProject(projectId)
          .where("route", "==", route)
          .where("viewport", "==", viewport)
          .orderBy("capturedAt", "desc")
          .limit(limit),
      )
    },

    async listByArchetype(projectId, archetypeId) {
      return readAll<Screen>(inProject(projectId).where("archetypeId", "==", archetypeId))
    },
  }
}
