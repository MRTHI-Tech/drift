"use client"

/**
 * One captured screen of the watched product.
 *
 * One of the four custom components AGENTS.md section 5 allows. The registry
 * has no thumbnail card, and this one is deliberately not shaped like Drift's
 * own chrome: Drift is square-cornered and flat, and the watched product sits
 * inside a rounded, inset frame with a caption bar under it, so it always reads
 * as something being looked at rather than as part of the tool looking at it.
 * Every value it uses is a preset variable or a utility mapped to one.
 *
 * The highlight is drawn in the screen's own coordinate space. A capture is a
 * full-page PNG taken at the viewport's declared width, so the page height in
 * CSS pixels is that width times the image's aspect ratio, and an element's
 * recorded box becomes a percentage of the rendered image without anything
 * needing to be stored about how tall the page was.
 */

import * as React from "react"
import { RiImageLine } from "@remixicon/react"
// The constants and types subpaths, not the package root: this component runs
// in the browser, and the root re-exports firebase-admin and Octokit.
import { VIEWPORT_SIZES } from "@drift/core/constants"
import type { BoundingBox, Viewport } from "@drift/core/types"

import { cn } from "@/lib/utils"
import { screenLabel } from "@/lib/format"

export interface ScreenThumbnailProps {
  screenId: string
  route: string
  viewport: Viewport
  /** The element to draw a box around, in document CSS pixels. */
  highlight?: BoundingBox | null
  /** A line under the frame, in place of the route. */
  caption?: React.ReactNode
  /** Anything to sit in the top right of the frame, such as a badge. */
  marker?: React.ReactNode
  /** Frame height. `tall` is for the comparison view, `short` for a row. */
  size?: "short" | "tall"
  /** Scroll the highlighted element into view once the image has loaded. */
  revealHighlight?: boolean
  className?: string
}

export function ScreenThumbnail({
  screenId,
  route,
  viewport,
  highlight = null,
  caption,
  marker,
  size = "short",
  revealHighlight = false,
  className,
}: ScreenThumbnailProps) {
  const [ratio, setRatio] = React.useState<number | null>(null)
  const [failed, setFailed] = React.useState(false)
  const frame = React.useRef<HTMLDivElement>(null)
  const marked = React.useRef<HTMLDivElement>(null)

  const pageHeight =
    ratio === null ? null : VIEWPORT_SIZES[viewport].width * ratio

  React.useEffect(() => {
    if (!revealHighlight || !highlight || pageHeight === null) return
    const target = marked.current
    const container = frame.current
    if (!target || !container) return

    // Centre the element rather than scroll it to the top edge, so what is
    // around it is visible too. That context is half of the evidence.
    container.scrollTop = Math.max(
      0,
      target.offsetTop - container.clientHeight / 2 + target.clientHeight / 2
    )
  }, [revealHighlight, highlight, pageHeight])

  const box =
    highlight && pageHeight !== null
      ? {
          left: `${(highlight.x / VIEWPORT_SIZES[viewport].width) * 100}%`,
          width: `${(highlight.width / VIEWPORT_SIZES[viewport].width) * 100}%`,
          top: `${(highlight.y / pageHeight) * 100}%`,
          height: `${(highlight.height / pageHeight) * 100}%`,
        }
      : null

  return (
    <figure className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="relative">
        <div
          ref={frame}
          className={cn(
            "relative overflow-y-auto rounded-lg bg-muted ring-1 ring-border",
            size === "tall" ? "h-96" : "h-40"
          )}
        >
          {failed ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
              <RiImageLine />
              <span className="text-xs leading-relaxed">
                The capture of {screenLabel(route, viewport)} could not be
                loaded from Cloud Storage.
              </span>
            </div>
          ) : (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- the bytes
                  come from Cloud Storage through a session-checked route, which
                  the image optimiser cannot reach. */}
              <img
                src={`/api/screens/${encodeURIComponent(screenId)}/image`}
                alt={`${screenLabel(route, viewport)}, as it was captured`}
                className="block w-full"
                onLoad={(event) => {
                  const image = event.currentTarget
                  setRatio(image.naturalHeight / image.naturalWidth)
                }}
                onError={() => setFailed(true)}
              />

              {box ? (
                <div
                  ref={marked}
                  aria-hidden
                  className="pointer-events-none absolute rounded-sm bg-primary/10 ring-2 ring-primary"
                  style={box}
                />
              ) : null}
            </div>
          )}
        </div>

        {marker ? <div className="absolute top-2 right-2">{marker}</div> : null}
      </div>

      <figcaption className="truncate font-mono text-xs text-muted-foreground">
        {caption ?? screenLabel(route, viewport)}
      </figcaption>
    </figure>
  )
}
