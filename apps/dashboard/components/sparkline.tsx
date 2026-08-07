/**
 * The drift score over its last runs, as one line.
 *
 * One of the four custom components AGENTS.md section 5 allows, because the
 * registry has no sparkline. It introduces no styling constants: every colour
 * is `currentColor` inherited from whatever it sits in, and its only geometry
 * is the view box, which is a coordinate space rather than a size.
 *
 * The line is drawn over the range the scores actually occupy rather than 0 to
 * 100, because a product moving between 88 and 94 should look like it moved.
 */

const VIEW_WIDTH = 100
const VIEW_HEIGHT = 24

export interface SparklinePoint {
  score: number
  at: Date
}

export function Sparkline({
  points,
  className,
  label,
}: {
  /** Oldest first. Fewer than two draws nothing. */
  points: readonly SparklinePoint[]
  className?: string
  label: string
}) {
  if (points.length < 2) return null

  const scores = points.map((point) => point.score)
  const low = Math.min(...scores)
  const high = Math.max(...scores)
  const span = high - low

  const coordinates = points.map((point, index) => {
    const x = (index / (points.length - 1)) * VIEW_WIDTH
    // A flat run sits in the middle rather than on the floor, so an unchanging
    // score reads as a level line and not as a bad one.
    const y =
      span === 0
        ? VIEW_HEIGHT / 2
        : VIEW_HEIGHT - ((point.score - low) / span) * VIEW_HEIGHT
    return [x, y] as const
  })

  const line = coordinates
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ")
  const last = coordinates[coordinates.length - 1]

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label={label}
    >
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {last ? (
        <circle
          cx={last[0]}
          cy={last[1]}
          r="1.5"
          fill="currentColor"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  )
}
