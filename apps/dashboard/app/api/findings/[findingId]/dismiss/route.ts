/**
 * Dismiss: nothing to do here. No convention changes and no pull request
 * opens. The finding is not deleted, and its dedupe key means a later run does
 * not raise it again (AGENTS.md section 2): a dismissal is a decision, and
 * decisions stand.
 */
import { handleResolution, type FindingParams } from "@/lib/resolutions"

// firebase-admin and Octokit both need Node, not the edge runtime.
export const runtime = "nodejs"

export async function POST(request: Request, context: FindingParams): Promise<Response> {
  return handleResolution(request, context, "dismiss")
}
