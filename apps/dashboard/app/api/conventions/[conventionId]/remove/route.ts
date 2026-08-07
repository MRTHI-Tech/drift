/**
 * Remove: stop stating this convention. It leaves the rules file and stops
 * being compared against, and the document stays so the findings that cite it
 * can still be read and still be resolved.
 */
import {
  handleConventionAction,
  type ConventionParams,
} from "@/lib/convention-actions"

// firebase-admin and Octokit both need Node, not the edge runtime.
export const runtime = "nodejs"

export async function POST(
  _request: Request,
  context: ConventionParams
): Promise<Response> {
  return handleConventionAction(context, "remove")
}
