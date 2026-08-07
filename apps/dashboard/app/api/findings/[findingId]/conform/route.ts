/**
 * Conform: the convention was right and this screen should be brought to it.
 * Opens the patch where the fix is mechanical, and stores the pull request
 * number on the finding.
 */
import { handleResolution, type FindingParams } from "@/lib/resolutions"

// firebase-admin and Octokit both need Node, not the edge runtime.
export const runtime = "nodejs"

export async function POST(request: Request, context: FindingParams): Promise<Response> {
  return handleResolution(request, context, "conform")
}
