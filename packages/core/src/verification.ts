/**
 * Whether a fix actually worked.
 *
 * Drift opens a pull request and then stops looking. A finding resolved as
 * `conform` says a person agreed the screen should change; it does not say the
 * screen changed. Between those two is every fix that was merged and did not
 * take, every one that was closed unmerged, and every patch that edited the
 * literal somebody meant but not the one the screen was rendering.
 *
 * That gap is not merely unverified, it is invisible. `createIfNew` refuses to
 * write a finding whose dedupe key already exists, whatever status that finding
 * carries, so a resolved finding suppresses its own recurrence forever. The
 * drift comes back, Drift sees it, and says nothing because it believes the
 * matter is closed.
 *
 * So a run asks the question the pull request could not answer. It renders the
 * product as it now stands, and for every finding somebody claimed to have
 * fixed it checks whether the value is still there. Nothing new is rendered
 * and nothing new is measured: the answer is already in what the run just did.
 *
 * Only `resolved_conform` is checked, and the reason is worth stating. That
 * action means this screen should change, so the value going away is exactly
 * what success looks like. `resolved_update_siblings` means the opposite, that
 * this screen was right and the others move, so its value staying is success
 * and its absence would be the surprise. An exception means a person said the
 * screen is allowed to differ, permanently, and asking again would be Drift
 * relitigating a decision it was told to respect (AGENTS.md section 6).
 */

import type { Finding } from "./types"

/** What the run saw, and which findings claimed to have been fixed. */
export interface VerificationInput {
  /** Findings resolved as `conform`, whose values should be gone. */
  claimed: readonly Finding[]
  /**
   * Every dedupe key the render just raised. A claimed finding whose key is
   * in here is a fix that did not take.
   */
  observed: ReadonlySet<string>
  /** Routes this run rendered. */
  routes: ReadonlySet<string>
  /** The route each finding's screen sat on, by screen id. */
  routeOf: ReadonlyMap<string, string>
}

export interface VerificationResult {
  /** The value is gone. The fix worked, and this is the evidence it did. */
  fixed: Finding[]
  /**
   * The value is still being rendered. Whatever happened to the pull request,
   * the product did not change.
   */
  unfixed: Finding[]
  /**
   * The route was not rendered this run, so there is no evidence either way.
   * Silence here is honest rather than a pass.
   */
  unchecked: Finding[]
}

/**
 * Sorts claimed fixes into what held, what did not, and what could not be
 * checked. Pure: the same run over the same findings always answers the same.
 */
export function verifyFixes(input: VerificationInput): VerificationResult {
  const result: VerificationResult = { fixed: [], unfixed: [], unchecked: [] }

  for (const finding of input.claimed) {
    if (finding.status !== "resolved_conform") continue

    const route = input.routeOf.get(finding.screenId)
    if (route === undefined || !input.routes.has(route)) {
      result.unchecked.push(finding)
      continue
    }

    if (input.observed.has(finding.dedupeKey)) result.unfixed.push(finding)
    else result.fixed.push(finding)
  }

  return result
}

/** The findings worth asking about at all: resolved as conform, and token. */
export function claimedFixes(findings: readonly Finding[]): Finding[] {
  return findings.filter(
    (finding) => finding.status === "resolved_conform" && finding.type === "token",
  )
}
