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
 *
 * A thumbnail is a crop. A mobile capture is a tall page shown through a frame
 * a few hundred pixels high, so most of the screen is out of sight, and a
 * person cannot check evidence they cannot see. Every thumbnail therefore opens
 * into a drawer holding the whole capture at close to the width it was rendered
 * at, with the same box drawn from the same record. The frame and the drawer
 * share one `Capture`, so what the drawer shows is the thumbnail's own image
 * rather than a second reading of it.
 */

import * as React from "react"
import {
  RiCloseLine,
  RiExpandDiagonalLine,
  RiImageLine,
} from "@remixicon/react"
// The constants and types subpaths, not the package root: this component runs
// in the browser, and the root re-exports firebase-admin and Octokit.
import { VIEWPORT_SIZES } from "@drift/core/constants"
import type { BoundingBox, Viewport } from "@drift/core/types"

import { cn } from "@/lib/utils"
import { screenLabel } from "@/lib/format"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"

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
  const label = screenLabel(route, viewport)

  return (
    <figure className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="relative">
        <Capture
          screenId={screenId}
          route={route}
          viewport={viewport}
          highlight={highlight}
          reveal={revealHighlight}
          className={cn(
            "rounded-lg bg-muted ring-1 ring-border",
            size === "tall" ? "h-96" : "h-40"
          )}
        />

        {marker ? <div className="absolute top-2 right-2">{marker}</div> : null}

        <Drawer>
          <DrawerTrigger
            render={
              <Button
                variant="secondary"
                size="icon-sm"
                className="absolute right-2 bottom-2"
              />
            }
          >
            <RiExpandDiagonalLine />
            <span className="sr-only">Open the whole capture of {label}</span>
          </DrawerTrigger>

          <DrawerContent className="h-dvh">
            <DrawerHeader>
              <DrawerTitle className="font-mono">{label}</DrawerTitle>
              <DrawerDescription>
                {highlight
                  ? "The whole capture, with the cited element boxed where its own extraction record puts it."
                  : "The whole capture, as Drift rendered it."}
              </DrawerDescription>
            </DrawerHeader>

            <DrawerClose
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-3 right-3"
                />
              }
            >
              <RiCloseLine />
              <span className="sr-only">Close</span>
            </DrawerClose>

            <div className="min-h-0 flex-1 px-4 pb-4">
              <Capture
                screenId={screenId}
                route={route}
                viewport={viewport}
                highlight={highlight}
                reveal={highlight !== null}
                className={cn(
                  "mx-auto h-full rounded-lg bg-muted ring-1 ring-border",
                  // Close to the width it was rendered at, so the screen reads
                  // the way it does on a phone rather than stretched across a
                  // desktop drawer.
                  viewport === "mobile" && "max-w-sm"
                )}
              />
            </div>
          </DrawerContent>
        </Drawer>
      </div>

      <figcaption className="truncate font-mono text-xs text-muted-foreground">
        {caption ?? label}
      </figcaption>
    </figure>
  )
}

interface CaptureProps {
  screenId: string
  route: string
  viewport: Viewport
  highlight: BoundingBox | null
  /** Scroll the highlighted element into view once the image has loaded. */
  reveal: boolean
  /** The scrolling frame: its height, and any clamp on its width. */
  className?: string
}

/**
 * The image and the box on it, inside a frame that scrolls. Used at two sizes,
 * so it owns the load state rather than the thumbnail: the drawer's copy loads
 * on its own and reports its own failure.
 */
function Capture({
  screenId,
  route,
  viewport,
  highlight,
  reveal,
  className,
}: CaptureProps) {
  const [ratio, setRatio] = React.useState<number | null>(null)
  const [failed, setFailed] = React.useState(false)
  const frame = React.useRef<HTMLDivElement>(null)
  const marked = React.useRef<HTMLDivElement>(null)

  const pageHeight =
    ratio === null ? null : VIEWPORT_SIZES[viewport].width * ratio

  React.useEffect(() => {
    if (!reveal || !highlight || pageHeight === null) return
    const target = marked.current
    const container = frame.current
    if (!target || !container) return

    // Centre the element rather than scroll it to the top edge, so what is
    // around it is visible too. That context is half of the evidence.
    container.scrollTop = Math.max(
      0,
      target.offsetTop - container.clientHeight / 2 + target.clientHeight / 2
    )
  }, [reveal, highlight, pageHeight])

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
    <div ref={frame} className={cn("relative overflow-y-auto", className)}>
      {failed ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
          <RiImageLine />
          <span className="text-xs leading-relaxed">
            The capture of {screenLabel(route, viewport)} could not be loaded
            from Cloud Storage.
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
  )
}
