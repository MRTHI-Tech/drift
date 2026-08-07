/**
 * Accept as exception: this screen is allowed to differ, permanently
 * (AGENTS.md section 6). The reason is recorded on the convention and appears
 * in the rules file, so the next agent to read it knows not to change the
 * screen back. Needs a `reason` in the body; opens no pull request.
 */
import { handleResolution, type FindingParams } from "@/lib/resolutions"

// firebase-admin and Octokit both need Node, not the edge runtime.
export const runtime = "nodejs"

export async function POST(
  request: Request,
  context: FindingParams
): Promise<Response> {
  return handleResolution(request, context, "exception")
}
