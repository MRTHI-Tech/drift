/**
 * The Fixer as the rest of the system asks for it.
 *
 * `openAutonomousPullRequests` needs a `FixProposer`, which is a port declared
 * in `@drift/core` precisely so that core does not have to know a model exists.
 * This is the other side of it. The mapping is dull on purpose: a finding's
 * evidence is already the whole of what the Fixer is told, and anything this
 * function added to that would be a fact nobody measured.
 */

import {
  evidenceSentence,
  patchKindOf,
  valueGroupOf,
  type FixProposal,
  type FixProposer,
  type FixRequest,
} from "@drift/core"

import { proposeFix } from "./flows"
import type { AgentLogger } from "./logging"

/** A proposer bound to one run's logger, for `openAutonomousPullRequests`. */
export function fixerFor(logger: AgentLogger): FixProposer {
  return async (request: FixRequest): Promise<FixProposal> => {
    const { finding } = request
    const { evidence } = finding

    const result = await proposeFix(
      {
        route: request.route,
        selector: evidence.selector ?? "the screen",
        property: evidence.property,
        observedValue: evidence.observedValue,
        expectedValue: evidence.expectedValue,
        expectedSource: evidence.expectedSource ?? "",
        sentence: evidenceSentence(finding),
        blocked: request.blocked,
        kind: patchKindOf(finding),
        group: valueGroupOf(evidence.property),
        files: [...request.files],
      },
      logger,
    )

    return { plan: result.plan, reasons: result.reasons }
  }
}
