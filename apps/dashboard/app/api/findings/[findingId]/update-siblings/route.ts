/**
 * Update siblings: this screen was right and the convention moves to it. The
 * convention is promoted to the observed value on this screen's evidence, the
 * rules file is regenerated, and the patch runs the other way, bringing the
 * siblings to what this screen already renders.
 */
import { handleResolution, type FindingParams } from "@/lib/resolutions"

// firebase-admin and Octokit both need Node, not the edge runtime.
export const runtime = "nodejs"

export async function POST(request: Request, context: FindingParams): Promise<Response> {
  return handleResolution(request, context, "update_siblings")
}
