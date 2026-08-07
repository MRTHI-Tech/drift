/**
 * A moment, written once. Both formats come from `Intl`, so the string depends
 * on the reader's locale and time zone; the server renders it in its own and
 * the browser corrects it on hydration, which is what the suppression is for.
 */

import { fullTimestamp, relativeTime, timestamp } from "@/lib/format"

export function Timestamp({
  value,
  relative = false,
  withYear = false,
}: {
  value: Date
  /** Write it as how long ago rather than as a clock time. */
  relative?: boolean
  withYear?: boolean
}) {
  const text = relative
    ? relativeTime(value)
    : withYear
      ? fullTimestamp(value)
      : timestamp(value)

  return (
    <time
      dateTime={value.toISOString()}
      title={fullTimestamp(value)}
      suppressHydrationWarning
    >
      {text}
    </time>
  )
}
