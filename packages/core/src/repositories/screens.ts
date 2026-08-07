import type { Firestore } from "firebase-admin/firestore"

import { COLLECTIONS } from "../constants"
import type { Screen, ScreenSummary, Viewport } from "../types"
import { createBaseRepository, readAll, type BaseRepository } from "./base"

/** The stored fields a summary is projected from. */
const SUMMARY_FIELDS = [
  "projectId",
  "runId",
  "route",
  "viewport",
  "archetypeId",
  "screenshotPath",
  "capturedAt",
] as const

export interface ScreenRepository extends BaseRepository<Screen> {
  /** Every screen captured by one run. */
  listByRun(projectId: string, runId: string): Promise<Screen[]>
  /** The history of one route at one viewport, newest capture first. */
  listByRoute(projectId: string, route: string, viewport: Viewport, limit?: number): Promise<Screen[]>
  /** Sibling screens: everything classified into the same archetype. */
  listByArchetype(projectId: string, archetypeId: string): Promise<Screen[]>
  /**
   * Every screen of a project without its extraction record, newest capture
   * first. What the drift score counts against and what a run's screen count
   * comes from.
   */
  listSummaries(projectId: string): Promise<ScreenSummary[]>
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

    async listSummaries(projectId) {
      return readAll<ScreenSummary>(
        inProject(projectId)
          .orderBy("capturedAt", "desc")
          .select(...SUMMARY_FIELDS),
      )
    },
  }
}
