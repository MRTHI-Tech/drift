"use client"

/**
 * The decision. Three ways to resolve a pattern finding and one way to set it
 * aside, wired to the four routes under `/api/findings/[findingId]`.
 *
 * Each button says what it does to the product rather than what it does to the
 * record: conforming changes this screen, updating the others moves the
 * convention here and changes them, an exception says this screen may differ
 * and is respected permanently (AGENTS.md section 6). None of them is styled as
 * the safe one, because none of them is; only the primary action of the two
 * that open a patch carries the accent.
 *
 * A token finding gets the smaller set: it answers to a token rather than to a
 * family of screens, so there are no siblings to move a convention to, and the
 * endpoint refuses that action anyway.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  RiArrowGoBackLine,
  RiCheckLine,
  RiCloseLine,
  RiGroupLine,
  RiLoader4Line,
} from "@remixicon/react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { responseError, type ResolutionResponse } from "@/lib/resolution-result"
import { ResolutionOutcome } from "./resolution-outcome"

type Action = "conform" | "update-siblings" | "exception" | "dismiss"

export function ResolutionActions({
  findingId,
  kind,
  observedValue,
  expectedValue,
  siblingCount,
}: {
  findingId: string
  kind: "pattern" | "token"
  observedValue: string
  expectedValue: string
  /** Screens the expected value was counted across. */
  siblingCount: number
}) {
  const router = useRouter()
  const [pending, setPending] = React.useState<Action | null>(null)
  const [result, setResult] = React.useState<ResolutionResponse | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [reasonOpen, setReasonOpen] = React.useState(false)
  const [reason, setReason] = React.useState("")

  async function resolve(action: Action, body?: { reason: string }) {
    setPending(action)
    setError(null)

    try {
      const response = await fetch(`/api/findings/${findingId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      })
      const payload: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(
          responseError(payload) ?? "That decision did not go through."
        )
      }

      setResult(payload as ResolutionResponse)
      setReasonOpen(false)
      // The score, the status badge, and the convention this touched all live
      // in server components. Refreshing is what makes the number tick.
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(null)
    }
  }

  const busy = pending !== null

  if (result) {
    return <ResolutionOutcome result={result} />
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => resolve("conform")} disabled={busy}>
          {pending === "conform" ? (
            <RiLoader4Line className="animate-spin" data-icon="inline-start" />
          ) : (
            <RiCheckLine data-icon="inline-start" />
          )}
          {kind === "token"
            ? `Snap this screen to ${expectedValue}`
            : `Change this screen to ${expectedValue}`}
        </Button>

        {kind === "pattern" ? (
          <Button
            variant="outline"
            onClick={() => resolve("update-siblings")}
            disabled={busy}
          >
            {pending === "update-siblings" ? (
              <RiLoader4Line
                className="animate-spin"
                data-icon="inline-start"
              />
            ) : (
              <RiGroupLine data-icon="inline-start" />
            )}
            Move the convention to {observedValue} and change the other{" "}
            {siblingCount}
          </Button>
        ) : null}

        <Button
          variant="outline"
          onClick={() => setReasonOpen(true)}
          disabled={busy}
        >
          <RiArrowGoBackLine data-icon="inline-start" />
          Accept as an exception
        </Button>

        <Button
          variant="ghost"
          onClick={() => resolve("dismiss")}
          disabled={busy}
        >
          {pending === "dismiss" ? (
            <RiLoader4Line className="animate-spin" data-icon="inline-start" />
          ) : (
            <RiCloseLine data-icon="inline-start" />
          )}
          Dismiss
        </Button>
      </div>

      <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
        Conforming and moving the convention each open a pull request, and only
        where the fix is one literal swapped for another. Anything needing a
        judgment about the code waits for you. Dismissing changes nothing and is
        remembered: this value on this route is never raised again.
      </p>

      {error ? (
        <p className="text-xs leading-relaxed text-destructive">{error}</p>
      ) : null}

      <Dialog open={reasonOpen} onOpenChange={setReasonOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept this screen as an exception</DialogTitle>
            <DialogDescription>
              This is respected permanently. It goes into the rules file, so the
              next agent working in this repo knows not to change the screen
              back. Say why.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="exception-reason">Reason</Label>
            <Textarea
              id="exception-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={`This screen keeps ${observedValue} because`}
              rows={3}
            />
          </div>

          {error ? (
            <p className="text-xs leading-relaxed text-destructive">{error}</p>
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              onClick={() => resolve("exception", { reason })}
              disabled={busy || reason.trim().length === 0}
            >
              {pending === "exception" ? (
                <RiLoader4Line
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : null}
              Accept as an exception
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
