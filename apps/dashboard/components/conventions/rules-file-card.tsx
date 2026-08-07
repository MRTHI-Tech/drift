"use client"

/**
 * The rules file card: where `drift.rules.md` last went, and what it says now.
 *
 * The sync time is asked of GitHub rather than remembered in Firestore, so the
 * two can never disagree (see `rules-sync.ts`). The content in the modal is
 * composed from the conventions as they stand, so it is what Drift would write
 * if a convention moved right now.
 */

import { RiExternalLinkLine, RiFileTextLine } from "@remixicon/react"

import { Timestamp } from "@/components/timestamp"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"

export interface RulesFileCardProps {
  path: string
  branch: string
  repo: string
  content: string
  lastSync: { at: string; sha: string; url: string } | null
  syncError: string | null
}

export function RulesFileCard({
  path,
  branch,
  repo,
  content,
  lastSync,
  syncError,
}: RulesFileCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{path}</CardTitle>
        <CardDescription>
          What this product already does, written for the next coding agent
          working in {repo}. Drift rewrites it whenever a convention changes and
          commits it to {branch}.
        </CardDescription>

        <CardAction>
          <Dialog>
            <DialogTrigger render={<Button variant="outline" size="sm" />}>
              <RiFileTextLine data-icon="inline-start" />
              Read it
            </DialogTrigger>

            <DialogContent className="sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>{path}</DialogTitle>
                <DialogDescription>
                  As Drift would write it now, from the conventions on this
                  page.
                </DialogDescription>
              </DialogHeader>

              <ScrollArea className="h-96">
                <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {content}
                </pre>
              </ScrollArea>

              <DialogFooter showCloseButton />
            </DialogContent>
          </Dialog>
        </CardAction>
      </CardHeader>

      <CardContent>
        {lastSync ? (
          <p className="text-muted-foreground">
            Last synced <Timestamp value={new Date(lastSync.at)} relative /> as{" "}
            <a
              className="font-mono underline underline-offset-3 hover:text-foreground"
              href={lastSync.url}
              target="_blank"
              rel="noreferrer"
            >
              {lastSync.sha.slice(0, 7)}
              <RiExternalLinkLine className="ml-1 inline size-3 align-text-bottom" />
            </a>
            .
          </p>
        ) : syncError ? (
          <p className="text-muted-foreground">
            The sync time could not be read from GitHub. {syncError}
          </p>
        ) : (
          <p className="text-muted-foreground">
            Not synced yet. The first time it goes out it arrives as a pull
            request; after that it is committed straight to {branch}.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
