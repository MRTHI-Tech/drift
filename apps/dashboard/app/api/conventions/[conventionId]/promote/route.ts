/**
 * Promote: you chose this value. The convention stops being something Drift
 * counted and becomes something you decided, and the rules file says so.
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
  return handleConventionAction(context, "promote")
}
