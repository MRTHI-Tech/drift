/**
 * Turning reconciled divergences into `findings` documents of type `pattern`,
 * through the same dedupe gate token findings go through: one finding per
 * project, route, property, and observed value, whatever the status of the
 * finding that already holds the key (AGENTS.md section 2). A screen that
 * still says Next on the second run raises nothing new, and a divergence the
 * user has dismissed stays dismissed.
 *
 * Everything reaching here has already passed the reconciliation gate. This
 * module writes; it does not decide.
 */

import { dedupeKey, type Finding, type FindingRepository, type NewEntity } from "@drift/core"

import type { JudgedDivergence } from "./reconcile"

export interface PatternFindingInput {
  projectId: string
  runId: string
  screenId: string
  route: string
  judged: JudgedDivergence
  createdAt?: Date
}

/** One reconciled divergence as a finding document. Pure. */
export function patternFinding(input: PatternFindingInput): NewEntity<Finding> {
  const { candidate } = input.judged

  return {
    projectId: input.projectId,
    runId: input.runId,
    type: "pattern",
    screenId: input.screenId,
    conventionId: candidate.conventionId,
    evidence: {
      selector: candidate.selector,
      property: candidate.property,
      observedValue: candidate.observedValue,
      expectedValue: candidate.expectedValue,
      expectedSource: candidate.expectedSource,
      siblingScreenIds: candidate.siblingScreenIds,
      sentence: input.judged.sentence,
    },
    severity: candidate.severity,
    status: "open",
    dedupeKey: dedupeKey({
      projectId: input.projectId,
      route: input.route,
      property: candidate.property,
      observedValue: candidate.observedValue,
    }),
    prNumber: null,
    createdAt: input.createdAt ?? new Date(),
    resolvedAt: null,
  }
}

export interface PersistPatternFindingsInput extends Omit<PatternFindingInput, "judged"> {
  findings: FindingRepository
  judged: readonly JudgedDivergence[]
}

export interface PatternFindingsResult {
  created: Finding[]
  /** Divergences an existing finding already covers, of any status. */
  alreadyKnown: number
}

export async function persistPatternFindings(
  input: PersistPatternFindingsInput,
): Promise<PatternFindingsResult> {
  const created: Finding[] = []
  let alreadyKnown = 0

  for (const judged of input.judged) {
    const result = await input.findings.createIfNew(patternFinding({ ...input, judged }))
    if (result.created) created.push(result.finding)
    else alreadyKnown += 1
  }

  return { created, alreadyKnown }
}
