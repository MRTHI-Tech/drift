/**
 * deriveConventions: what an archetype's screens agree on.
 *
 * The derivation is counting and nothing but counting (`conventions.ts`).
 * Convention derivation is not on the list of model calls in AGENTS.md
 * section 4, and it should not be: a model asked what a family of screens has
 * in common will always answer, and Drift needs the answer to be true rather
 * than fluent. The floor from AGENTS.md section 2 is enforced here and again in
 * the repository: a value fewer than three screens render is not a convention.
 *
 * The one model call in this flow is the label, which is naming, not deriving.
 * A label that fails to come back leaves the convention stored under Drift's
 * own plain wording.
 */

import { MIN_SCREENS_PER_CONVENTION } from "@drift/core"
import { z } from "genkit"

import { deriveConventionProposals, fallbackLabel } from "../conventions"
import { silentLogger, type AgentLogger } from "../logging"
import { profileProperty, type ProfiledScreen } from "../profile"
import { ai } from "../genkit"
import { labelConvention } from "./label-convention"

const ProfileValueSchema = z.object({
  property: z.string(),
  kind: z.enum(["style", "copy", "derived"]),
  selector: z.string(),
  value: z.string(),
})

export const DeriveConventionsInput = z.object({
  archetypeLabel: z.string(),
  /** One entry per screen of the archetype, latest capture per route. */
  screens: z.array(
    z.object({
      screenId: z.string(),
      route: z.string(),
      profile: z.array(ProfileValueSchema),
    }),
  ),
})

export const DeriveConventionsOutput = z.object({
  conventions: z.array(
    z.object({
      property: z.string(),
      value: z.string(),
      label: z.string(),
      confidence: z.enum(["low", "medium", "high"]),
      evidenceScreenIds: z.array(z.string()),
      consideredScreens: z.number(),
    }),
  ),
})

export type DeriveConventionsInput = z.infer<typeof DeriveConventionsInput>
export type DeriveConventionsOutput = z.infer<typeof DeriveConventionsOutput>

const EMPTY: DeriveConventionsOutput = { conventions: [] }

export const deriveConventionsFlow = ai.defineFlow(
  {
    name: "deriveConventions",
    inputSchema: DeriveConventionsInput,
    outputSchema: DeriveConventionsOutput,
  },
  async (input) => deriveConventions(input, silentLogger),
)

export async function deriveConventions(
  input: DeriveConventionsInput,
  logger: AgentLogger,
): Promise<DeriveConventionsOutput> {
  if (input.screens.length < MIN_SCREENS_PER_CONVENTION) return EMPTY

  const proposals = deriveConventionProposals(input.screens as ProfiledScreen[])
  const conventions: DeriveConventionsOutput["conventions"] = []

  for (const proposal of proposals) {
    // Belt and braces. `deriveConventionProposals` already enforces the floor
    // and so does the repository, and this is where a future refactor would
    // quietly lose it.
    if (proposal.evidenceScreenIds.length < MIN_SCREENS_PER_CONVENTION) continue

    const named = await labelConvention(
      {
        archetypeLabel: input.archetypeLabel,
        property: proposal.property,
        reads: profileProperty(proposal.property)?.reads ?? proposal.property,
        value: proposal.value,
        agreeing: proposal.evidenceScreenIds.length,
        considered: proposal.consideredScreens,
      },
      logger,
    )

    conventions.push({
      property: proposal.property,
      value: proposal.value,
      label: named.label.length > 0 ? named.label : fallbackLabel(proposal.property, proposal.value),
      confidence: proposal.confidence,
      evidenceScreenIds: proposal.evidenceScreenIds,
      consideredScreens: proposal.consideredScreens,
    })
  }

  return { conventions }
}
