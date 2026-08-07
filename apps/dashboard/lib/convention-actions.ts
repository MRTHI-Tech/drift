/**
 * The two things a person can do to a convention directly, and the only writes
 * in Drift that are not a resolution.
 *
 *   promote  you chose this value, so stop calling it derived
 *   remove   stop stating it at all
 *
 * Removing sets `status` to `removed` rather than deleting the document. The
 * rules file already treats a removed convention as stating nothing
 * (`rules.ts`), and a finding holds its `conventionId`: a resolution has to be
 * able to read the convention it answers to, and a hard delete would turn every
 * finding pointing at it into a 404 that can never be resolved. Findings are
 * never deleted (AGENTS.md section 2), so neither is what they cite.
 *
 * Both regenerate `drift.rules.md`, because both change what it would say.
 */

import {
  createGitHubClient,
  syncRulesFile,
  type Convention,
  type ConventionStatus,
} from "@drift/core"

import { repositories } from "@/lib/data/workspace"
import { requireApiSession } from "@/lib/session"

export type ConventionAction = "promote" | "remove"

/** What each action sets on the convention. */
const PATCH_OF_ACTION: Record<ConventionAction, { status: ConventionStatus }> =
  {
    promote: { status: "promoted" },
    remove: { status: "removed" },
  }

export interface ConventionParams {
  params: Promise<{ conventionId: string }>
}

export async function handleConventionAction(
  context: ConventionParams,
  action: ConventionAction
): Promise<Response> {
  const gate = await requireApiSession()
  if (gate.response) return gate.response

  const { conventionId } = await context.params
  const repos = repositories()

  const convention = await repos.conventions.get(conventionId)
  if (!convention) {
    return Response.json(
      { error: `There is no convention ${conventionId}.` },
      { status: 404 }
    )
  }

  const project = await repos.projects.get(convention.projectId)
  if (!project) {
    return Response.json(
      {
        error: `Convention ${conventionId} belongs to a project that is gone.`,
      },
      { status: 404 }
    )
  }

  const updated = await repos.conventions.update(conventionId, {
    ...PATCH_OF_ACTION[action],
    // Promoting is a person choosing the value, which is a stronger claim than
    // counting ever makes.
    ...(action === "promote" ? { confidence: "high" as const } : {}),
    updatedAt: new Date(),
  })

  return Response.json({
    convention: present(updated),
    ...(await regenerateRules(project.id, repos)),
  })
}

/**
 * Rewrites the rules file. Caught rather than thrown: the convention already
 * moved, and a GitHub that cannot be reached is something to report next to the
 * change rather than a reason to undo it.
 */
async function regenerateRules(
  projectId: string,
  repos: ReturnType<typeof repositories>
): Promise<{ rules: unknown; rulesError: string | null }> {
  const project = await repos.projects.get(projectId)
  if (!project) return { rules: null, rulesError: null }

  try {
    const result = await syncRulesFile({
      octokit: createGitHubClient(),
      project,
      repositories: repos,
    })

    return {
      rules: {
        path: result.path,
        branch: result.branch,
        changed: result.changed,
        prNumber: result.prNumber,
      },
      rulesError: null,
    }
  } catch (error) {
    // The conventions page composes the file from Firestore either way, so a
    // failure here costs the watched repo its copy and costs the page nothing.
    return {
      rules: null,
      rulesError: error instanceof Error ? error.message : String(error),
    }
  }
}

function present(convention: Convention) {
  return {
    id: convention.id,
    property: convention.property,
    value: convention.value,
    status: convention.status,
    confidence: convention.confidence,
  }
}
