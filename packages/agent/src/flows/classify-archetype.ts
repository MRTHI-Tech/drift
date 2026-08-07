/**
 * classifyArchetype: what kind of screen is this.
 *
 * The model proposes a label from the screenshot and the signature. It does not
 * decide which screens belong together; that is measured from embeddings in
 * `cluster.ts`. A label is a name for a family, and naming is the only part of
 * the job a model is allowed to do here (AGENTS.md section 4).
 */

import { z } from "genkit"

import { MAX_LABEL_LENGTH } from "../constants"
import { ai } from "../genkit"
import { silentLogger, type AgentLogger } from "../logging"
import { CLASSIFY_ARCHETYPE_SYSTEM, CLASSIFY_ARCHETYPE_TASK } from "../prompts"
import { attemptOrEmpty } from "../retry"
import { fill, lines, screenshotDataUri } from "./render"

export const ClassifyArchetypeInput = z.object({
  route: z.string(),
  viewport: z.string(),
  /** The signature as `signatureText` encodes it. */
  signature: z.string(),
  /** PNG as a base64 string or a data URI. */
  screenshot: z.string(),
  /** Labels already in use in this project, so the model reuses one. */
  existingLabels: z.array(z.string()),
})

export const ClassifyArchetypeOutput = z.object({
  /** Two to four words naming the family. Empty when the call failed. */
  label: z.string(),
})

export type ClassifyArchetypeInput = z.infer<typeof ClassifyArchetypeInput>
export type ClassifyArchetypeOutput = z.infer<typeof ClassifyArchetypeOutput>

const EMPTY: ClassifyArchetypeOutput = { label: "" }

export const classifyArchetypeFlow = ai.defineFlow(
  {
    name: "classifyArchetype",
    inputSchema: ClassifyArchetypeInput,
    outputSchema: ClassifyArchetypeOutput,
  },
  async (input) => classifyArchetype(input, silentLogger),
)

/**
 * The flow with a logger attached. Returns an empty label rather than throwing
 * when the model fails twice; an unlabelled screen simply stays unassigned.
 */
export async function classifyArchetype(
  input: ClassifyArchetypeInput,
  logger: AgentLogger,
): Promise<ClassifyArchetypeOutput> {
  const task = fill(CLASSIFY_ARCHETYPE_TASK, {
    route: input.route,
    viewport: input.viewport,
    signature: input.signature,
    existingLabels: lines(input.existingLabels, "none yet"),
  })

  return attemptOrEmpty(
    async () => {
      const response = await ai.generate({
        system: CLASSIFY_ARCHETYPE_SYSTEM,
        prompt: [{ text: task }, { media: { url: screenshotDataUri(input.screenshot) } }],
        output: { schema: ClassifyArchetypeOutput },
      })

      const label = response.output?.label ?? ""
      return { label: tidy(label) }
    },
    { name: "classifyArchetype", empty: EMPTY, logger },
  )
}

/** One line, no trailing stop, short enough to sit in a nav. */
function tidy(label: string): string {
  const cleaned = label.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "")
  return cleaned.length <= MAX_LABEL_LENGTH ? cleaned : cleaned.slice(0, MAX_LABEL_LENGTH).trim()
}
