/**
 * What arrives at the dashboard's push endpoint when a watched repo redeploys.
 *
 * Two layers, parsed separately because they fail for different reasons. The
 * outer envelope is Pub/Sub's own wrapper and a malformed one means the request
 * did not come from Pub/Sub. The inner payload is the watched repo's message
 * and a malformed one means somebody's deploy pipeline publishes the wrong
 * shape, which is worth naming precisely in a log line.
 *
 * The payload is strict, for the same reason `drift.config.json` is strict
 * (AGENTS.md section 2a): a typo in a key that is silently ignored is a deploy
 * that silently never triggers a run.
 */
import { z } from "zod"

/**
 * Pub/Sub's push envelope. `data` is optional because a message may carry only
 * attributes, and this is not the place to decide that is wrong.
 */
export const pushEnvelopeSchema = z
  .object({
    message: z.object({
      data: z.string().optional(),
      messageId: z.string().optional(),
      publishTime: z.string().optional(),
      attributes: z.record(z.string(), z.string()).optional(),
    }),
    subscription: z.string().optional(),
  })
  .loose()

export type PushEnvelope = z.infer<typeof pushEnvelopeSchema>

/**
 * The message a watched repo's deploy pipeline publishes. `repo` is the only
 * required field: it is how the endpoint finds which project redeployed. The
 * other two are for the log line, so a run that fired can be traced back to the
 * commit that caused it.
 */
export const deployEventSchema = z
  .object({
    /** `owner/name`, matched against a project's `repo`. */
    repo: z
      .string()
      .regex(/^[^/\s]+\/[^/\s]+$/, "A repo must be owner/name"),
    /** Commit the preview was built from. */
    commit: z.string().min(1).optional(),
    /** Branch or tag the deploy came from, for example `refs/heads/main`. */
    ref: z.string().min(1).optional(),
  })
  .strict()

export type DeployEvent = z.infer<typeof deployEventSchema>

/** A message that could not be read, with the reason a person needs. */
export interface MessageProblem {
  reason: string
}

export type Parsed<T> = { value: T; problem: null } | { value: null; problem: MessageProblem }

/** The envelope, or why the body is not one. */
export function parsePushEnvelope(body: unknown): Parsed<PushEnvelope> {
  const result = pushEnvelopeSchema.safeParse(body)
  if (!result.success) {
    return problem("The body is not a Pub/Sub push envelope.")
  }
  return { value: result.data, problem: null }
}

/**
 * The deploy event inside an envelope. Pub/Sub base64-encodes the data, so it
 * is decoded, then read as JSON, then validated, and each of those three can
 * fail differently.
 */
export function parseDeployEvent(envelope: PushEnvelope): Parsed<DeployEvent> {
  const encoded = envelope.message.data
  if (!encoded) {
    return problem("The message carried no data.")
  }

  let text: string
  try {
    text = Buffer.from(encoded, "base64").toString("utf8")
  } catch {
    return problem("The message data is not base64.")
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return problem("The message data is not JSON.")
  }

  const result = deployEventSchema.safeParse(value)
  if (!result.success) {
    const first = result.error.issues[0]
    const where = first && first.path.length > 0 ? ` at ${first.path.join(".")}` : ""
    return problem(`The message is not a deploy event${where}: ${first?.message ?? "invalid"}.`)
  }

  return { value: result.data, problem: null }
}

function problem<T>(reason: string): Parsed<T> {
  return { value: null, problem: { reason } }
}
