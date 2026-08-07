/**
 * The repository set in memory, for tests.
 *
 * Keeps the rules the Firestore ones keep and that actuation depends on:
 * findings are never deleted and only ever change status, resolutions are
 * append-only, and a convention's exceptions are added to rather than replaced.
 *
 * Screens carry a `screenshotPath` that is not a `gs://` path on purpose, so
 * the evidence images fail to load and no test ever reaches Cloud Storage. A
 * pull request with the patch and no pictures is still a pull request, which is
 * exactly the behaviour that path is meant to have.
 */

import type { Repositories } from "../repositories"
import type {
  Archetype,
  Convention,
  Finding,
  FindingStatus,
  Project,
  Resolution,
  Screen,
} from "../types"

export interface FakeRepositories extends Repositories {
  stored: {
    projects: Project[]
    screens: Screen[]
    archetypes: Archetype[]
    conventions: Convention[]
    findings: Finding[]
    resolutions: Resolution[]
  }
}

export interface FakeSeed {
  projects?: Project[]
  screens?: Screen[]
  archetypes?: Archetype[]
  conventions?: Convention[]
  findings?: Finding[]
}

export function fakeRepositories(seed: FakeSeed = {}): FakeRepositories {
  const stored = {
    projects: [...(seed.projects ?? [])],
    screens: [...(seed.screens ?? [])],
    archetypes: [...(seed.archetypes ?? [])],
    conventions: [...(seed.conventions ?? [])],
    findings: [...(seed.findings ?? [])],
    resolutions: [] as Resolution[],
  }

  const find = <T extends { id: string }>(rows: T[], id: string): T | null =>
    rows.find((row) => row.id === id) ?? null

  // `values` is deliberately `object`: each repository's patch type is narrower
  // than this helper can infer, and the repositories are cast to their
  // interfaces anyway, which is where the real checking happens.
  const patch = <T extends { id: string }>(rows: T[], id: string, values: object): T => {
    const row = find(rows, id)
    if (!row) throw new Error(`No such document ${id}`)
    Object.assign(row, values)
    return row
  }

  return {
    stored,

    projects: {
      async get(id) {
        return find(stored.projects, id)
      },
      async update(id, values) {
        return patch(stored.projects, id, values)
      },
    } as Repositories["projects"],

    screens: {
      async get(id) {
        return find(stored.screens, id)
      },
      async listByArchetype(_projectId, archetypeId) {
        return stored.screens.filter((screen) => screen.archetypeId === archetypeId)
      },
    } as Repositories["screens"],

    archetypes: {
      async listByProject(projectId) {
        return stored.archetypes.filter((archetype) => archetype.projectId === projectId)
      },
    } as Repositories["archetypes"],

    conventions: {
      async get(id) {
        return find(stored.conventions, id)
      },
      async update(id, values) {
        return patch(stored.conventions, id, values)
      },
      async listByProject(projectId) {
        return stored.conventions.filter((convention) => convention.projectId === projectId)
      },
    } as Repositories["conventions"],

    findings: {
      async get(id) {
        return find(stored.findings, id)
      },
      async update(id, values) {
        return patch(stored.findings, id, values)
      },
      async setStatus(id, status: FindingStatus, at = new Date()) {
        return patch(stored.findings, id, {
          status,
          resolvedAt: status === "open" ? null : at,
        })
      },
    } as Repositories["findings"],

    resolutions: {
      async create(input) {
        const resolution = { ...input, id: `resolution${stored.resolutions.length + 1}` }
        stored.resolutions.push(resolution)
        return resolution
      },
      async listByFinding(_projectId, findingId) {
        return stored.resolutions.filter((resolution) => resolution.findingId === findingId)
      },
    } as Repositories["resolutions"],

    runs: {} as Repositories["runs"],
  }
}
