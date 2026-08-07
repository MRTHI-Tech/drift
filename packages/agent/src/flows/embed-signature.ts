/**
 * embedSignature: a screen's signature as a vector, so screens of one kind can
 * be found by distance rather than by opinion.
 *
 * A Genkit flow like the rest, because every model interaction in Drift goes
 * through one (AGENTS.md section 1). It has no prompt file: an embedder is
 * asked for a vector, not for an answer. A failed call returns an empty vector,
 * which leaves the screen unassigned rather than clustered on a guess.
 */

import { googleAI } from "@genkit-ai/google-genai"
import { z } from "genkit"

import { ai } from "../genkit"
import { silentLogger, type AgentLogger } from "../logging"
import { GEMINI_EMBEDDING_MODEL } from "../models"
import { attemptOrEmpty } from "../retry"

export const EmbedSignatureInput = z.object({
  /** The signature as `signatureText` encodes it. */
  signature: z.string(),
})

export const EmbedSignatureOutput = z.object({
  /** Empty when the call failed twice. */
  embedding: z.array(z.number()),
})

export type EmbedSignatureInput = z.infer<typeof EmbedSignatureInput>
export type EmbedSignatureOutput = z.infer<typeof EmbedSignatureOutput>

const EMPTY: EmbedSignatureOutput = { embedding: [] }

export const embedSignatureFlow = ai.defineFlow(
  {
    name: "embedSignature",
    inputSchema: EmbedSignatureInput,
    outputSchema: EmbedSignatureOutput,
  },
  async (input) => embedSignature(input, silentLogger),
)

export async function embedSignature(
  input: EmbedSignatureInput,
  logger: AgentLogger,
): Promise<EmbedSignatureOutput> {
  return attemptOrEmpty(
    async () => {
      const embeddings = await ai.embed({
        embedder: googleAI.embedder(GEMINI_EMBEDDING_MODEL),
        content: input.signature,
      })
      return { embedding: embeddings[0]?.embedding ?? [] }
    },
    { name: "embedSignature", empty: EMPTY, logger },
  )
}
