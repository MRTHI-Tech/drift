import type { Firestore } from "firebase-admin/firestore"

import { getDriftFirestore } from "../firestore"
import { createArchetypeRepository, type ArchetypeRepository } from "./archetypes"
import { createConventionRepository, type ConventionRepository } from "./conventions"
import { createFindingRepository, type FindingRepository } from "./findings"
import { createInstallationRepository, type InstallationRepository } from "./installations"
import { createProjectRepository, type ProjectRepository } from "./projects"
import { createResolutionRepository, type ResolutionRepository } from "./resolutions"
import { createRunRepository, type RunRepository } from "./runs"
import { createScreenRepository, type ScreenRepository } from "./screens"

export type { BaseRepository } from "./base"
export type { Entity, EntityPatch, NewEntity } from "./document"
export type { ArchetypeRepository } from "./archetypes"
export type { ConventionRepository } from "./conventions"
export type { FindingRepository, FindingWriteResult } from "./findings"
export type { InstallationRepository } from "./installations"
export type { ProjectRepository } from "./projects"
export type { ResolutionRepository } from "./resolutions"
export type { RunRepository } from "./runs"
export type { ScreenRepository } from "./screens"

export {
  createArchetypeRepository,
  createConventionRepository,
  createFindingRepository,
  createInstallationRepository,
  createProjectRepository,
  createResolutionRepository,
  createRunRepository,
  createScreenRepository,
}

/** One repository per collection, all pointed at the same database. */
export interface Repositories {
  projects: ProjectRepository
  installations: InstallationRepository
  runs: RunRepository
  screens: ScreenRepository
  archetypes: ArchetypeRepository
  conventions: ConventionRepository
  findings: FindingRepository
  resolutions: ResolutionRepository
}

/** Builds the repository set. Defaults to the shared Firestore client. */
export function createRepositories(db: Firestore = getDriftFirestore()): Repositories {
  return {
    projects: createProjectRepository(db),
    installations: createInstallationRepository(db),
    runs: createRunRepository(db),
    screens: createScreenRepository(db),
    archetypes: createArchetypeRepository(db),
    conventions: createConventionRepository(db),
    findings: createFindingRepository(db),
    resolutions: createResolutionRepository(db),
  }
}
