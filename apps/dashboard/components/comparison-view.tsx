"use client"

/**
 * The divergent screen beside its archetype siblings.
 *
 * One of the four custom components AGENTS.md section 5 allows. It is the whole
 * argument a pattern finding makes, laid out so the argument is visible before
 * any of it is read: this screen on the left with the element boxed, the
 * screens it was counted against on the right with the same element boxed on
 * each. Every image is a real capture out of Cloud Storage; nothing here is a
 * mockup or a placeholder.
 *
 * The sibling boxes come from each sibling's own extraction record, looked up
 * by the same selector, so a sibling whose element the extractor recorded under
 * a different selector shows no box rather than a guessed one.
 */

import type { BoundingBox, Screen } from "@drift/core/types"

import { ScreenThumbnail } from "@/components/screen-thumbnail"
import { Badge } from "@/components/ui/badge"

export interface ComparisonViewProps {
  /** The screen the finding is about. */
  divergent: Screen
  /** The screens the expected value was counted across. */
  siblings: readonly Screen[]
  /** The element the value was seen on, or null for a screen-wide finding. */
  selector: string | null
  observedValue: string
  expectedValue: string
  /** Name of the archetype these screens share, for the sibling heading. */
  archetypeLabel: string | null
}

export function ComparisonView({
  divergent,
  siblings,
  selector,
  observedValue,
  expectedValue,
  archetypeLabel,
}: ComparisonViewProps) {
  const family = archetypeLabel
    ? `${archetypeLabel} screens`
    : "sibling screens"

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <section className="flex min-w-0 flex-col gap-3 lg:col-span-2">
        <header className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">This screen</h3>
          <span className="font-mono text-xs text-muted-foreground">
            {observedValue}
          </span>
        </header>

        <ScreenThumbnail
          screenId={divergent.id}
          route={divergent.route}
          viewport={divergent.viewport}
          highlight={boxOf(divergent, selector)}
          size="tall"
          revealHighlight
          marker={<Badge>Diverges</Badge>}
        />
      </section>

      <section className="flex min-w-0 flex-col gap-3 lg:col-span-3">
        <header className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">
            {siblings.length} {family}
          </h3>
          <span className="font-mono text-xs text-muted-foreground">
            {expectedValue}
          </span>
        </header>

        {siblings.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            This screen has no siblings captured. A screen classified into no
            archetype is never judged for pattern drift, so there is nothing to
            compare it against here.
          </p>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-3">
            {siblings.map((sibling) => (
              <ScreenThumbnail
                key={sibling.id}
                screenId={sibling.id}
                route={sibling.route}
                viewport={sibling.viewport}
                highlight={boxOf(sibling, selector)}
                size="tall"
                revealHighlight
                className="w-64 shrink-0"
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/** Where an element sat on a screen, out of that screen's own record. */
function boxOf(screen: Screen, selector: string | null): BoundingBox | null {
  if (!selector) return null
  return screen.computedStyles[selector]?.box ?? null
}
