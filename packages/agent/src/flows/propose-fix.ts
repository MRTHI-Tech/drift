/**
 * proposeFix: the correction for a finding the mechanical patcher would not
 * make.
 *
 * This is the Fixer, and it is the only place in Drift that reads a watched
 * repo's own code. AGENTS.md section 10a used to forbid the whole class. It now
 * admits it, bounded not by a refusal but by the fix gate, and the order below
 * is the whole of the arrangement:
 *
 *   1. `planFindingPatch` has already tried and said why it could not. The
 *      Fixer is never the first thing asked; it gets the findings that a
 *      character-for-character substitution could not put right, and it is told
 *      the reason so it is not solving a problem that was already solved.
 *   2. The model reads the repo through tools that are pure functions over a
 *      fixed set of files (`repo-tools.ts`). It cannot open a file that was not
 *      fetched, reach the network, or see the repo change under it.
 *   3. Everything it proposes goes through `gateProposedFix` before it leaves
 *      this function, the same way a judged finding goes through the
 *      reconciliation gate before it leaves `judgePatternDrift`. The gate is
 *      inside the flow rather than beside it, so there is no caller that can go
 *      around it and no path that returns an ungated edit.
 *
 * What comes back is a `PatchPlan` marked `model`, which everything downstream
 * treats as a proposal: it opens as a draft, and `isAutonomousFix` refuses it
 * unprompted. The gate can prove an edit applies and touches the value the
 * finding named. It cannot prove the result compiles, and nothing short of
 * building the watched repo could. That gap is why a person still opens it.
 */

import {
  gateProposedFix,
  type FixArrival,
  type PatchPlan,
  type ProposedEdit,
  type SourceFile,
  type TokenGroup,
} from "@drift/core"
import { z } from "genkit"

import { MAX_FIX_TURNS } from "../constants"
import { ai } from "../genkit"
import { silentLogger, type AgentLogger } from "../logging"
import { PROPOSE_FIX_SYSTEM, PROPOSE_FIX_TASK } from "../prompts"
import { listRepoFiles, readRepoFile, searchRepo } from "../repo-tools"
import { attemptOrEmpty } from "../retry"
import { fill } from "./render"

export const ProposeFixInput = z.object({
  route: z.string(),
  selector: z.string(),
  property: z.string(),
  observedValue: z.string(),
  expectedValue: z.string(),
  expectedSource: z.string(),
  /** What the cited element actually says on the screen. May be empty. */
  observedText: z.string(),
  /** The evidence line the judgment phase already wrote. */
  sentence: z.string(),
  /** Why the mechanical patcher would not do this. Never empty. */
  blocked: z.string(),
  kind: z.enum(["copy", "value"]),
  /** The scale the value answers to, for its spellings. Null for copy. */
  group: z.string().nullable(),
  files: z.custom<SourceFile[]>((value) => Array.isArray(value), {
    message: "files must be the source files the repo was fetched with",
  }),
  /**
   * How the gate checks that the fix arrived. Omitted for a value written in
   * source, which is the ordinary case; supplied for a derived property, whose
   * target is a reading rather than a literal.
   */
  arrival: z.custom<FixArrival>(() => true).optional(),
  /** Text that also counts as arriving, such as the token's own name. */
  alsoAccept: z.array(z.string()).optional(),
})

export const ProposeFixOutput = z.object({
  /** Null when nothing survived the gate, which is a common answer. */
  plan: z.custom<PatchPlan | null>(() => true),
  /** Edits the model returned. */
  proposed: z.number(),
  /** Edits that survived the gate. */
  kept: z.number(),
  /** Drops by reason. AGENTS.md section 10a requires these to be logged. */
  dropped: z.record(z.string(), z.number()),
  /** One line per drop, plus the model's own line when it declined. */
  reasons: z.array(z.string()),
})

/** What the model is allowed to return, and all it is allowed to return. */
const ModelEdits = z.object({
  edits: z.array(
    z.object({
      path: z.string(),
      find: z.string(),
      replace: z.string(),
    }),
  ),
  /** One line: what it changed, or why it changed nothing. */
  note: z.string(),
})

export type ProposeFixInput = z.infer<typeof ProposeFixInput>
export type ProposeFixOutput = z.infer<typeof ProposeFixOutput>

const EMPTY: ProposeFixOutput = {
  plan: null,
  proposed: 0,
  kept: 0,
  dropped: {},
  reasons: [],
}

/**
 * The repo as three questions the model may ask of it, bound to one fetched
 * set of files. Dynamic rather than registered, because the files differ on
 * every call and a tool that closes over one run's repo has no business
 * outliving it.
 */
function repoToolsFor(files: readonly SourceFile[], logger: AgentLogger) {
  return [
    ai.dynamicTool(
      {
        name: "searchRepo",
        description:
          "Find every line containing a piece of text, matched literally and without regard to case. Use this first, and try more than one spelling of the value.",
        inputSchema: z.object({ query: z.string().describe("The text to look for.") }),
        outputSchema: z.object({
          hits: z.array(z.object({ path: z.string(), line: z.number(), text: z.string() })),
          total: z.number(),
          truncated: z.boolean(),
        }),
      },
      async ({ query }) => {
        const found = searchRepo(files, query)
        logger.log("fixer.tool", { tool: "searchRepo", query, hits: found.total })
        return found
      },
    ),
    ai.dynamicTool(
      {
        name: "readRepoFile",
        description:
          "Read a file, or a window of it, exactly as it is written. Quote from what this returns when you write an edit.",
        inputSchema: z.object({
          path: z.string(),
          from: z.number().optional().describe("First line, 1-indexed. Defaults to 1."),
          to: z.number().optional().describe("Last line, inclusive."),
        }),
        outputSchema: z
          .object({
            path: z.string(),
            from: z.number(),
            to: z.number(),
            total: z.number(),
            text: z.string(),
          })
          .nullable(),
      },
      async ({ path, from, to }) => {
        const slice = readRepoFile(files, path, from ?? 1, to)
        logger.log("fixer.tool", { tool: "readRepoFile", path, found: slice !== null })
        return slice
      },
    ),
    ai.dynamicTool(
      {
        name: "listRepoFiles",
        description: "Every source file path available, optionally narrowed to one prefix.",
        inputSchema: z.object({ prefix: z.string().optional() }),
        outputSchema: z.object({ paths: z.array(z.string()) }),
      },
      async ({ prefix }) => {
        const paths = listRepoFiles(files, prefix ?? "")
        logger.log("fixer.tool", { tool: "listRepoFiles", prefix: prefix ?? "", paths: paths.length })
        return { paths }
      },
    ),
  ]
}

export const proposeFixFlow = ai.defineFlow(
  {
    name: "proposeFix",
    inputSchema: ProposeFixInput,
    outputSchema: ProposeFixOutput,
  },
  async (input) => proposeFix(input, silentLogger),
)

export async function proposeFix(
  input: ProposeFixInput,
  logger: AgentLogger,
): Promise<ProposeFixOutput> {
  if (input.files.length === 0) return EMPTY

  const task = fill(PROPOSE_FIX_TASK, {
    route: input.route,
    selector: input.selector,
    property: input.property,
    observedValue: input.observedValue,
    expectedValue: input.expectedValue,
    expectedSource: input.expectedSource,
    observedText: input.observedText.length > 0 ? input.observedText : "not recorded",
    sentence: input.sentence,
    blocked: input.blocked,
    fileCount: input.files.length,
  })

  const answer = await attemptOrEmpty<{ edits: ProposedEdit[]; note: string }>(
    async () => {
      const response = await ai.generate({
        system: PROPOSE_FIX_SYSTEM,
        prompt: task,
        tools: repoToolsFor(input.files, logger),
        maxTurns: MAX_FIX_TURNS,
        output: { schema: ModelEdits },
      })
      return { edits: response.output?.edits ?? [], note: response.output?.note ?? "" }
    },
    { name: "proposeFix", empty: { edits: [], note: "" }, logger },
  )

  // The gate. Nothing returns from this function without passing it.
  const gate = gateProposedFix({
    edits: answer.edits,
    files: input.files,
    kind: input.kind,
    from: input.observedValue,
    to: input.expectedValue,
    group: (input.group as TokenGroup | null) ?? null,
    arrival: input.arrival,
    alsoAccept: input.alsoAccept,
  })

  const reasons = [...gate.reasons]
  if (gate.plan === null && answer.note.trim().length > 0) {
    reasons.push(`The Fixer said: ${answer.note.trim()}`)
  }

  logger.log("fixer.proposed", {
    route: input.route,
    property: input.property,
    proposed: gate.proposed,
    kept: gate.kept,
    opened: gate.plan !== null,
  })

  return {
    plan: gate.plan,
    proposed: gate.proposed,
    kept: gate.kept,
    dropped: gate.dropped,
    reasons,
  }
}
