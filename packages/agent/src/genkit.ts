import { googleAI } from "@genkit-ai/google-genai"
import { genkit } from "genkit"

import { GEMINI_MODEL } from "./models"

/**
 * The single Genkit instance. Every model call in Drift goes through a flow
 * defined on this instance; nothing else may talk to the Gemini API
 * (AGENTS.md section 1).
 *
 * The API key is read from GEMINI_API_KEY by the plugin.
 */
export const ai = genkit({
  plugins: [googleAI()],
  model: googleAI.model(GEMINI_MODEL),
})
