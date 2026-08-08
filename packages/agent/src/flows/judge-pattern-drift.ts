/**
 * judgePatternDrift: does a measured divergence matter, and how is it said.
 *
 * The order here is the whole design and it does not bend.
 *
 *   1. Divergence candidates are computed deterministically, before this flow
 *      runs, by comparing the screen's profile against its archetype's
 *      conventions (`divergence.ts`). Every candidate is already true.
 *   2. The model receives those candidates, the conventions, and the
 *      screenshot. Nothing else. It is never handed the screen with the
 *      question "what is wrong here", and there is no path through this file
 *      that would let it raise a finding of its own.
 *   3. Everything it proposes goes through the reconciliation gate
 *      (AGENTS.md section 3) before it leaves this function. A cited value
 *      that is not in the screen's own record is dropped silently and counted.
 *
 * The flow returns findings that have already been reconciled, and the drop
 * counters for the caller to log. A screen with no candidates never reaches the
 * model at all.
 */

import type { ComputedStyles } from "@drift/core"
import { z } from "genkit"

import { ai } from "../genkit"
import { silentLogger, type AgentLogger } from "../logging"
import { JUDGE_PATTERN_DRIFT_SYSTEM, JUDGE_PATTERN_DRIFT_TASK } from "../prompts"
import { reconcile, type Assessment } from "../reconcile"
import { attemptOrEmpty } from "../retry"
import type { DivergenceCandidate } from "../divergence"
import { fill, lines, screenshotDataUri } from "./render"

const CandidateSchema = z.object({
  conventionId: z.string(),
  property: z.string(),
  kind: z.enum(["style", "copy", "derived"]),
  selector: z.string(),
  observedValue: z.string(),
  expectedValue: z.string(),
  expectedSource: z.string(),
  siblingScreenIds: z.array(z.string()),
  severity: z.number(),
})

const ConventionLineSchema = z.object({
  property: z.string(),
  value: z.string(),
  label: z.string(),
  confidence: z.string(),
  evidenceCount: z.number(),
})

/**
 * The screen's own extraction, narrowed to the elements the candidates cite.
 * This is the record the gate reads and the only source of an observed value.
 */
const ExtractionSchema = z.object({
  computedStyles: z.custom<ComputedStyles>(
    (value) => typeof value === "object" && value !== null,
    { message: "computedStyles must be the extracted record" },
  ),
  text: z.record(z.string(), z.string()),
})

export const JudgePatternDriftInput = z.object({
  route: z.string(),
  viewport: z.string(),
  archetypeLabel: z.string(),
  /** PNG as a base64 string or a data URI. */
  screenshot: z.string(),
  conventions: z.array(ConventionLineSchema),
  candidates: z.array(CandidateSchema),
  extraction: ExtractionSchema,
})

export const JudgePatternDriftOutput = z.object({
  findings: z.array(z.object({ candidate: CandidateSchema, sentence: z.string() })),
  /** Assessments the model returned. */
  proposed: z.number(),
  /** Divergences the model judged not worth raising. */
  immaterial: z.number(),
  /** Dropped by the reconciliation gate. AGENTS.md section 3. */
  dropped: z.number(),
  /** Proposals naming something outside the candidate list. */
  droppedOutsideCandidates: z.number(),
  /** Sentences Drift rewrote because the model's own line was unusable. */
  sentencesRewritten: z.number(),
})

/** What the model is allowed to return, and all it is allowed to return. */
const ModelAssessments = z.object({
  assessments: z.array(
    z.object({
      candidateIndex: z.number(),
      material: z.boolean(),
      citedSelector: z.string(),
      citedProperty: z.string(),
      citedValue: z.string(),
      sentence: z.string(),
    }),
  ),
})

export type JudgePatternDriftInput = z.infer<typeof JudgePatternDriftInput>
export type JudgePatternDriftOutput = z.infer<typeof JudgePatternDriftOutput>

const EMPTY: JudgePatternDriftOutput = {
  findings: [],
  proposed: 0,
  immaterial: 0,
  dropped: 0,
  droppedOutsideCandidates: 0,
  sentencesRewritten: 0,
}

export const judgePatternDriftFlow = ai.defineFlow(
  {
    name: "judgePatternDrift",
    inputSchema: JudgePatternDriftInput,
    outputSchema: JudgePatternDriftOutput,
  },
  async (input) => judgePatternDrift(input, silentLogger),
)

export async function judgePatternDrift(
  input: JudgePatternDriftInput,
  logger: AgentLogger,
): Promise<JudgePatternDriftOutput> {
  if (input.candidates.length === 0) return EMPTY

  const task = fill(JUDGE_PATTERN_DRIFT_TASK, {
    route: input.route,
    viewport: input.viewport,
    archetypeLabel: input.archetypeLabel,
    conventions: lines(input.conventions.map(conventionLine), "none derived yet"),
    candidates: lines(input.candidates.map(candidateLine)),
  })

  const assessments = await attemptOrEmpty<Assessment[]>(
    async () => {
      const response = await ai.generate({
        system: JUDGE_PATTERN_DRIFT_SYSTEM,
        prompt: [{ text: task }, { media: { url: screenshotDataUri(input.screenshot) } }],
        output: { schema: ModelAssessments },
      })
      return response.output?.assessments ?? []
    },
    { name: "judgePatternDrift", empty: [], logger },
  )

  // The gate. Nothing returns from this function without passing it.
  const gate = reconcile({
    candidates: input.candidates as DivergenceCandidate[],
    assessments,
    extraction: input.extraction,
  })

  return {
    findings: gate.kept.map((judged) => ({
      candidate: judged.candidate,
      sentence: judged.sentence,
    })),
    proposed: gate.proposed,
    immaterial: gate.immaterial,
    dropped: gate.dropped,
    droppedOutsideCandidates: gate.droppedOutsideCandidates,
    sentencesRewritten: gate.sentencesRewritten,
  }
}

function conventionLine(convention: z.infer<typeof ConventionLineSchema>): string {
  return `- ${convention.property} is ${convention.value}. ${convention.label}. ${convention.evidenceCount} screens, ${convention.confidence} confidence.`
}

/**
 * One candidate as the model reads it. Numbered, because the answer has to come
 * back keyed to the number: an answer that does not name a candidate on this
 * list is discarded rather than interpreted.
 */
function candidateLine(candidate: z.infer<typeof CandidateSchema>, index: number): string {
  return [
    `${index}. property: ${candidate.property}`,
    `   selector: ${candidate.selector}`,
    `   observed on this screen: ${candidate.observedValue}`,
    `   siblings render: ${candidate.expectedValue} (${candidate.siblingScreenIds.length} screens)`,
  ].join("\n")
}
