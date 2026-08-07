/**
 * Turning token-drift candidates into `findings` documents, through the dedupe
 * gate. A candidate whose dedupe key already belongs to a finding is not
 * written again, whatever status that finding is in: a dismissal is a decision,
 * and findings are never deleted (AGENTS.md section 2).
 */

import { dedupeKey } from "../dedupe"
import type { FindingRepository } from "../repositories/findings"
import type { NewEntity } from "../repositories/document"
import type { Finding } from "../types"
import type { TokenDriftCandidate } from "./token-diff"

export interface TokenFindingInput {
  projectId: string
  runId: string
  screenId: string
  route: string
  candidate: TokenDriftCandidate
  createdAt?: Date
}

/**
 * One candidate as a finding document. Pure: the same candidate always yields
 * the same document apart from its timestamp, which is why the dedupe key is
 * stable across runs.
 */
export function tokenFinding(input: TokenFindingInput): NewEntity<Finding> {
  const { candidate } = input

  return {
    projectId: input.projectId,
    runId: input.runId,
    type: "token",
    screenId: input.screenId,
    // Token findings answer to the token file, not to a convention.
    conventionId: null,
    evidence: {
      selector: candidate.selector,
      property: candidate.property,
      observedValue: candidate.observedValue,
      expectedValue: candidate.nearestToken?.value ?? "",
      expectedSource: candidate.nearestToken?.name ?? null,
      siblingScreenIds: [],
    },
    severity: candidate.severity,
    status: "open",
    dedupeKey: tokenDedupeKey(input.projectId, input.route, candidate),
    prNumber: null,
    createdAt: input.createdAt ?? new Date(),
    resolvedAt: null,
  }
}

/**
 * The key a token finding dedupes on: project, route, property, observed value
 * (AGENTS.md section 2). Deliberately not scoped to the element, so the same
 * hardcoded colour on a different element of the same screen is the same
 * finding, and so a run that re-renders the screen raises nothing new.
 */
export function tokenDedupeKey(
  projectId: string,
  route: string,
  candidate: TokenDriftCandidate,
): string {
  return dedupeKey({
    projectId,
    route,
    property: candidate.property,
    observedValue: candidate.observedValue,
  })
}

export interface PersistTokenFindingsInput extends Omit<TokenFindingInput, "candidate"> {
  findings: FindingRepository
  candidates: readonly TokenDriftCandidate[]
}

export interface TokenFindingsResult {
  /** Findings this run wrote. */
  created: Finding[]
  /** Candidates an existing finding already covers, of any status. */
  alreadyKnown: number
}

/** Writes every candidate that is not already a finding, in order. */
export async function persistTokenFindings(
  input: PersistTokenFindingsInput,
): Promise<TokenFindingsResult> {
  const created: Finding[] = []
  let alreadyKnown = 0

  for (const candidate of input.candidates) {
    const result = await input.findings.createIfNew(tokenFinding({ ...input, candidate }))
    if (result.created) created.push(result.finding)
    else alreadyKnown += 1
  }

  return { created, alreadyKnown }
}
