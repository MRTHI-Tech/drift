"use client"

/**
 * One convention, stated and then evidenced.
 *
 * The last of the four custom components AGENTS.md section 5 allows. Closed it
 * is a line: what the convention says, how sure it is, how many screens it was
 * counted across. Open it is the evidence itself, the real captures of those
 * screens with the value each one recorded, plus every exception and the reason
 * it was accepted.
 *
 * Promote and remove sit here because a convention is the only thing in Drift a
 * person edits directly. Removing sets the status rather than deleting the
 * document: a finding points at its convention, and a resolution has to be able
 * to read the convention it answers to even after the convention stopped being
 * stated.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  RiArrowRightSLine,
  RiCloseLine,
  RiLoader4Line,
  RiShieldCheckLine,
} from "@remixicon/react"
import type { Convention, ScreenSummary } from "@drift/core/types"

import { CONFIDENCE_LABEL, count, screenLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ScreenThumbnail } from "@/components/screen-thumbnail"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

export interface ConventionRowException {
  screenId: string
  screen: ScreenSummary | null
  reason: string
}

export interface ConventionRowProps {
  convention: Convention
  evidence: readonly ScreenSummary[]
  exceptions: readonly ConventionRowException[]
}

export function ConventionRow({
  convention,
  evidence,
  exceptions,
}: ConventionRowProps) {
  const router = useRouter()
  const [pending, setPending] = React.useState<"promote" | "remove" | null>(
    null
  )
  const [error, setError] = React.useState<string | null>(null)
  const removed = convention.status === "removed"

  async function act(action: "promote" | "remove") {
    setPending(action)
    setError(null)

    try {
      const response = await fetch(
        `/api/conventions/${convention.id}/${action}`,
        {
          method: "POST",
        }
      )
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok)
        throw new Error(readError(body) ?? "That did not go through.")

      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(null)
    }
  }

  return (
    <Collapsible
      className={cn(
        "border-b border-border last:border-b-0",
        removed && "opacity-60"
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="group/disclosure mt-px"
            />
          }
          aria-label={`Show the evidence for ${convention.property}`}
        >
          <RiArrowRightSLine className="transition-transform group-data-[panel-open]/disclosure:rotate-90" />
        </CollapsibleTrigger>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm leading-relaxed">{convention.label}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {convention.property} is {convention.value}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {removed ? <Badge variant="outline">Removed</Badge> : null}
          {convention.status === "promoted" ? <Badge>Promoted</Badge> : null}
          <Badge
            variant={convention.confidence === "high" ? "secondary" : "outline"}
          >
            {CONFIDENCE_LABEL[convention.confidence]}
          </Badge>
          <Badge variant="outline">
            {count(convention.evidenceScreenIds.length, "screen")}
          </Badge>
          {exceptions.length > 0 ? (
            <Badge variant="outline">
              {count(exceptions.length, "exception")}
            </Badge>
          ) : null}
        </div>
      </div>

      <CollapsibleContent>
        <div className="flex flex-col gap-5 px-4 pb-5 pl-11">
          <section className="flex flex-col gap-3">
            <h4 className="text-xs text-muted-foreground">
              Measured on {count(evidence.length, "captured screen")}
            </h4>

            {evidence.length === 0 ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                The screens this was counted across are no longer captured.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">
                {evidence.map((screen) => (
                  <ScreenThumbnail
                    key={screen.id}
                    screenId={screen.id}
                    route={screen.route}
                    viewport={screen.viewport}
                    caption={
                      <>
                        {screenLabel(screen.route, screen.viewport)}
                        <span className="block">{convention.value}</span>
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </section>

          {exceptions.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h4 className="text-xs text-muted-foreground">
                Accepted exceptions
              </h4>
              <ul className="flex flex-col gap-2">
                {exceptions.map((exception) => (
                  <li
                    key={exception.screenId}
                    className="flex flex-col gap-1 border-l-2 border-border pl-3"
                  >
                    <span className="font-mono text-xs">
                      {exception.screen
                        ? screenLabel(
                            exception.screen.route,
                            exception.screen.viewport
                          )
                        : exception.screenId}
                    </span>
                    <span className="text-xs leading-relaxed text-muted-foreground">
                      {exception.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => act("promote")}
              disabled={pending !== null || convention.status === "promoted"}
            >
              {pending === "promote" ? (
                <RiLoader4Line
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <RiShieldCheckLine data-icon="inline-start" />
              )}
              Promote
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => act("remove")}
              disabled={pending !== null || removed}
            >
              {pending === "remove" ? (
                <RiLoader4Line
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <RiCloseLine data-icon="inline-start" />
              )}
              Remove
            </Button>

            <p className="text-xs leading-relaxed text-muted-foreground">
              Promoting says you chose this value. Removing stops Drift stating
              it and takes it out of the rules file. Either way the rules file
              is regenerated.
            </p>
          </section>

          {error ? (
            <p className="text-xs leading-relaxed text-destructive">{error}</p>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function readError(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const error = (body as Record<string, unknown>).error
  return typeof error === "string" ? error : null
}
