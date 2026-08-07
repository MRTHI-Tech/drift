/**
 * labelConvention: the line a person reads on the conventions page.
 *
 * The convention itself was derived by counting. This names it, and names are
 * on the list of things a model may write (AGENTS.md section 4). A failed call
 * costs a convention its wording and nothing else: the caller falls back to
 * Drift's own plain label and stores the convention anyway.
 */

import { z } from "genkit"

import { MAX_LABEL_LENGTH } from "../constants"
import { ai } from "../genkit"
import { silentLogger, type AgentLogger } from "../logging"
import { LABEL_CONVENTION_SYSTEM, LABEL_CONVENTION_TASK } from "../prompts"
import { attemptOrEmpty } from "../retry"
import { fill } from "./render"

export const LabelConventionInput = z.object({
  archetypeLabel: z.string(),
  property: z.string(),
  /** How a person reads the property, from `PROFILE_PROPERTIES`. */
  reads: z.string(),
  value: z.string(),
  agreeing: z.number(),
  considered: z.number(),
})

export const LabelConventionOutput = z.object({
  /** At most ten words. Empty when the call failed. */
  label: z.string(),
})

export type LabelConventionInput = z.infer<typeof LabelConventionInput>
export type LabelConventionOutput = z.infer<typeof LabelConventionOutput>

const EMPTY: LabelConventionOutput = { label: "" }

export const labelConventionFlow = ai.defineFlow(
  {
    name: "labelConvention",
    inputSchema: LabelConventionInput,
    outputSchema: LabelConventionOutput,
  },
  async (input) => labelConvention(input, silentLogger),
)

export async function labelConvention(
  input: LabelConventionInput,
  logger: AgentLogger,
): Promise<LabelConventionOutput> {
  const task = fill(LABEL_CONVENTION_TASK, {
    archetypeLabel: input.archetypeLabel,
    property: input.property,
    reads: input.reads,
    value: input.value,
    agreeing: input.agreeing,
    considered: input.considered,
  })

  return attemptOrEmpty(
    async () => {
      const response = await ai.generate({
        system: LABEL_CONVENTION_SYSTEM,
        prompt: task,
        output: { schema: LabelConventionOutput },
      })

      return { label: tidy(response.output?.label ?? "") }
    },
    { name: "labelConvention", empty: EMPTY, logger },
  )
}

/**
 * One line, no trailing stop, no em dash, no exclamation (AGENTS.md section 6).
 * A label that breaks the copy rules comes back empty, which sends the caller
 * to Drift's own fallback rather than storing prose Drift would not write.
 */
function tidy(label: string): string {
  const cleaned = label.replace(/\s+/g, " ").trim().replace(/[.]+$/, "")
  if (cleaned.includes("—") || cleaned.includes("!")) return ""
  return cleaned.length <= MAX_LABEL_LENGTH ? cleaned : ""
}
