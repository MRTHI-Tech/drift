/**
 * A finding that has already been answered: what was decided, when, and where
 * the pull request went.
 *
 * Findings are never deleted (AGENTS.md section 2), so this is what the page
 * shows in place of the buttons. The resolutions are append-only, so resolving
 * the same finding twice reads as two entries here, in order.
 */

import { RiExternalLinkLine } from "@remixicon/react"
import type { Resolution } from "@drift/core/types"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Timestamp } from "@/components/timestamp"
import { FINDING_STATUS_LABEL } from "@/lib/format"
import type { FindingStatus } from "@drift/core/types"

export function SettledNotice({
  status,
  resolutions,
  pullRequestUrl,
  prNumber,
}: {
  status: FindingStatus
  resolutions: readonly Resolution[]
  pullRequestUrl: string | null
  prNumber: number | null
}) {
  return (
    <Alert>
      <AlertTitle>Decided: {FINDING_STATUS_LABEL[status]}</AlertTitle>
      <AlertDescription>
        {resolutions.length === 0 ? (
          <p>The decision was recorded before the resolutions log existed.</p>
        ) : (
          resolutions.map((resolution) => (
            <p key={resolution.id}>
              <Timestamp value={resolution.createdAt} withYear />
              {resolution.resultingConventionChange
                ? `. ${resolution.resultingConventionChange}`
                : ". Nothing about a convention changed."}
            </p>
          ))
        )}

        {pullRequestUrl ? (
          <p>
            <a href={pullRequestUrl} target="_blank" rel="noreferrer">
              Pull request #{prNumber}
              <RiExternalLinkLine className="ml-1 inline size-3 align-text-bottom" />
            </a>
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
