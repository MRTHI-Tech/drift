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
  type FixArrival,
  type FixProposal,
  type FixProposer,
  type FixRequest,
} from "@drift/core"

import { proposeFix } from "./flows"
import type { AgentLogger } from "./logging"
import { deriveFromLabel, profileProperty } from "./profile"

/**
 * How the fix gate should check that this finding's fix arrived.
 *
 * A style value or a label is written in source, so it can be looked for. A
 * derived property is not: nothing in a repo contains the word `warm`, and a
 * heading rewritten to sound warm still will not. Those are checked by reading
 * the new line the same way the screen's own line was read.
 */
export function arrivalFor(property: string, expectedValue: string): FixArrival {
  if (profileProperty(property)?.kind !== "derived") return { kind: "literal" }

  return {
    kind: "derived",
    reads: (text) => deriveFromLabel(property, text) === expectedValue,
  }
}

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
        observedText: request.observedText,
        blocked: request.blocked,
        kind: patchKindOf(finding),
        group: valueGroupOf(evidence.property),
        files: [...request.files],
        arrival: arrivalFor(evidence.property, evidence.expectedValue),
        // A token finding names the token it missed, and a fix that references
        // that token by name has done the better thing than pasting its value.
        alsoAccept:
          finding.type === "token" && evidence.expectedSource ? [evidence.expectedSource] : [],
      },
      logger,
    )

    return { plan: result.plan, reasons: result.reasons }
  }
}
