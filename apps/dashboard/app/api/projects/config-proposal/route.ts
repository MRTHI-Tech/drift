/**
 * Proposing a `drift.config.json` to a repo that has none.
 *
 * A setup file under AGENTS.md section 10b, and the one write in this dashboard
 * that happens before a project exists: somebody is adding a repo, the repo has
 * no config, and they pressed the button. `isAutonomousFix` is not consulted,
 * because nothing here is unprompted.
 *
 * The two gates hold underneath: the session, and the allowlist, which
 * `openConfigPullRequest` asserts before it touches the network and which
 * `github.ts` asserts again inside every write.
 */

import {
  composeConfigProposal,
  githubClientFor,
  createLogger,
  errorMessage,
  openConfigPullRequest,
  preflight,
  RepoNotAllowedError,
} from "@drift/core"

import { inspectionTarget, readProjectBody, repoRejection } from "@/lib/projects"
import { requireApiSession } from "@/lib/session"

// firebase-admin and Octokit both need Node, not the edge runtime.
export const runtime = "nodejs"

export async function POST(request: Request): Promise<Response> {
  const gate = await requireApiSession()
  if (gate.response) return gate.response

  const body = await readProjectBody(request)

  const rejected = repoRejection(body)
  if (rejected) return rejected

  const octokit = githubClientFor(body.installationId ?? null)
  const input = inspectionTarget(body)

  try {
    // Asked again rather than taken from the browser: whether a repo has a
    // config is the one fact this write turns on, and section 10b says an
    // existing one is never overwritten.
    const inspected = await preflight({ octokit, input })
    const project = {
      ...input,
      defaultBranch: inspected.repo?.defaultBranch ?? input.defaultBranch,
    }

    if (!inspected.configMissing) {
      return Response.json(
        {
          error: `${project.repo} already has ${project.configPath}. Drift does not change a config that is there.`,
        },
        { status: 409 },
      )
    }

    const proposal = await composeConfigProposal({ octokit, project })
    const opened = await openConfigPullRequest({
      octokit,
      project,
      proposal,
      logger: createLogger(),
    })

    return Response.json({
      number: opened.prNumber,
      url: opened.url,
      branch: opened.branch,
      path: opened.path,
    })
  } catch (error) {
    if (error instanceof RepoNotAllowedError) {
      return Response.json({ error: error.message }, { status: 403 })
    }
    return Response.json({ error: errorMessage(error) }, { status: 500 })
  }
}
