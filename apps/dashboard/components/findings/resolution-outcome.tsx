"use client"

/**
 * What just happened, said plainly.
 *
 * A resolution sets four things in motion and any of them can decline to
 * happen: the decision is recorded either way, the pull request opens only
 * where the patch is mechanical, the convention moves only where the action
 * implies it, and the rules file is rewritten only when a convention moved. All
 * four are reported, including the ones that did not, because "no pull request"
 * with a reason is a correct outcome and not a failure (AGENTS.md section 10).
 */

import { RiCheckLine, RiExternalLinkLine } from "@remixicon/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { count } from "@/lib/format"
import type { ResolutionResponse } from "@/lib/resolution-result"

export function ResolutionOutcome({ result }: { result: ResolutionResponse }) {
  return (
    <Alert>
      <RiCheckLine />
      <AlertTitle>Recorded</AlertTitle>
      <AlertDescription>
        {result.conventionChange ? <p>{result.conventionChange}</p> : null}

        {result.pullRequest ? (
          <p>
            Pull request{" "}
            <a href={result.pullRequest.url} target="_blank" rel="noreferrer">
              #{result.pullRequest.number}
              <RiExternalLinkLine className="ml-1 inline size-3 align-text-bottom" />
            </a>{" "}
            opened on {result.pullRequest.branch}, replacing{" "}
            {count(result.pullRequest.occurrences, "occurrence")} in{" "}
            {result.pullRequest.files.join(", ")}.
          </p>
        ) : null}

        {result.pullRequestSkipped ? (
          <p>No pull request. {result.pullRequestSkipped}</p>
        ) : null}
        {result.pullRequestError ? (
          <p>The pull request could not be opened. {result.pullRequestError}</p>
        ) : null}

        {result.rules?.changed ? (
          <p>
            {result.rules.path} was regenerated on {result.rules.branch}
            {result.rules.prNumber
              ? ` and proposed as #${result.rules.prNumber}`
              : ""}
            .
          </p>
        ) : null}
        {result.rulesError ? (
          <p>The rules file was not updated. {result.rulesError}</p>
        ) : null}

        {result.driftScore ? (
          <p>
            Drift score is now {result.driftScore.score}:{" "}
            {count(result.driftScore.openFindings, "open finding")} across{" "}
            {count(result.driftScore.screensChecked, "screen")} checked.
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
