/**
 * One retry with backoff around every model call, and an empty result on the
 * second failure. A model that is down, rate limited, or answering nonsense
 * costs the run its judgment and nothing else: the deterministic findings are
 * already written, and nothing here may throw into the pipeline
 * (AGENTS.md section 4).
 */

import { RETRY_BACKOFF_MS } from "./constants"
import { errorMessage, type AgentLogger } from "./logging"

export interface AttemptOptions<T> {
  /** Names the call in the log line a failure writes. */
  name: string
  /** What the caller gets when both attempts fail. */
  empty: T
  logger: AgentLogger
  /** Injectable so tests do not wait. */
  sleep?: (ms: number) => Promise<void>
  /**
   * Whether a failure is worth a second attempt. Defaults to yes, which is
   * what every call assumed before the Fixer existed.
   *
   * The rule in AGENTS.md section 4 caps retries at one; it does not require
   * spending that one on a failure that cannot come out differently. A model
   * that ran out of tool calls will run out of them again, and against a real
   * repo that cost four minutes to arrive at the same empty answer twice.
   */
  retryable?: (error: unknown) => boolean
  /** Wait before the second attempt. Defaults to `RETRY_BACKOFF_MS`. */
  backoffMs?: number
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * Runs `call`, retries it once after a backoff, and returns `empty` if that
 * fails too. Never throws.
 */
export async function attemptOrEmpty<T>(
  call: () => Promise<T>,
  options: AttemptOptions<T>,
): Promise<T> {
  const sleep = options.sleep ?? wait
  const retryable = options.retryable ?? (() => true)

  try {
    return await call()
  } catch (error) {
    options.logger.error("model.attempt_failed", {
      call: options.name,
      attempt: 1,
      message: errorMessage(error),
    })

    if (!retryable(error)) {
      options.logger.error("model.gave_up", {
        call: options.name,
        attempt: 1,
        retried: false,
        message: errorMessage(error),
      })
      return options.empty
    }
  }

  await sleep(options.backoffMs ?? RETRY_BACKOFF_MS)

  try {
    return await call()
  } catch (error) {
    options.logger.error("model.gave_up", {
      call: options.name,
      attempt: 2,
      message: errorMessage(error),
    })
    return options.empty
  }
}
