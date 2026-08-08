"use client"

/**
 * Adding a project.
 *
 * Two fields, because two things cannot be derived: which repo, and where it is
 * deployed. Everything else Drift reads out of the repo. Routes especially are
 * never asked for here: `drift.config.json` is the only declaration of what gets
 * rendered (AGENTS.md section 2a), and a second place to state them would be a
 * second truth.
 *
 * The panel under the fields is the point of the dialog. Every way a run fails
 * traces back to one of four things, and all four are asked here, while somebody
 * is still looking at the form, instead of ten minutes later in a run nobody is
 * watching. Two of them block. A preview that did not answer and a token file
 * that did not parse are said plainly and left to the person, because a run
 * survives both.
 *
 * A repo with no config gets both ways out: the file to copy, and, when the
 * allowlist permits a write, a pull request that adds it. That write is a setup
 * file under section 10b, not a patch, and it happens because somebody pressed
 * a button.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  RiCheckLine,
  RiCloseLine,
  RiErrorWarningLine,
  RiFileCopyLine,
  RiGitPullRequestLine,
  RiLoader4Line,
  RiSubtractLine,
} from "@remixicon/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  fieldError,
  responseMessage,
  type CheckStatus,
  type CreatedProject,
  type Inspection,
  type ProposedConfig,
} from "@/lib/project-result"

const CHECK_LABELS: Record<string, string> = {
  repo: "Repo",
  config: "Config",
  preview: "Preview",
  tokens: "Tokens",
}

export function AddProjectDialog({
  onCreated,
  trigger,
}: {
  /** Records the new project as the current one. The layout's server action. */
  onCreated: (projectId: string) => Promise<void>
  trigger: React.ReactNode
}) {
  const router = useRouter()

  const [open, setOpen] = React.useState(false)
  const [repo, setRepo] = React.useState("")
  const [previewUrl, setPreviewUrl] = React.useState("")
  const [name, setName] = React.useState("")
  const [nameEdited, setNameEdited] = React.useState(false)

  const [inspection, setInspection] = React.useState<Inspection | null>(null)
  const [inspecting, setInspecting] = React.useState(false)
  const [problem, setProblem] = React.useState<string | null>(null)
  const [fieldProblem, setFieldProblem] = React.useState<string | null>(null)

  const [working, setWorking] = React.useState<"create" | "propose" | null>(null)
  const [created, setCreated] = React.useState<CreatedProject | null>(null)
  const [proposed, setProposed] = React.useState<{ number: number; url: string } | null>(null)
  const [copied, setCopied] = React.useState(false)

  // What the last inspection was run against, so a field that did not change
  // does not start the same request again on every blur.
  const inspected = React.useRef<string>("")

  function reset() {
    setRepo("")
    setPreviewUrl("")
    setName("")
    setNameEdited(false)
    setInspection(null)
    setProblem(null)
    setFieldProblem(null)
    setCreated(null)
    setProposed(null)
    setCopied(false)
    inspected.current = ""
  }

  async function inspect(nextRepo = repo, nextPreviewUrl = previewUrl) {
    const trimmed = nextRepo.trim()
    if (!trimmed) return

    const key = `${trimmed}|${nextPreviewUrl.trim()}`
    if (key === inspected.current) return
    inspected.current = key

    setInspecting(true)
    setProblem(null)
    setFieldProblem(null)

    try {
      const response = await fetch("/api/projects/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: trimmed, previewUrl: nextPreviewUrl.trim() }),
      })
      const payload: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        setInspection(null)
        const message = responseMessage(payload) ?? "That repo could not be checked."
        if (fieldError(payload) === "repo") setFieldProblem(message)
        else setProblem(message)
        return
      }

      const result = payload as Inspection
      setInspection(result)

      // Show the repo as it will be stored. Somebody who pasted a URL should
      // see what Drift made of it rather than have to trust that it read it.
      if (result.repoSlug && result.repoSlug !== nextRepo) {
        setRepo(result.repoSlug)
        inspected.current = `${result.repoSlug}|${nextPreviewUrl.trim()}`
      }

      if (!nameEdited && result.repoSlug) {
        setName(suggestName(result.repoSlug))
      }
    } catch (error) {
      setInspection(null)
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setInspecting(false)
    }
  }

  /** Forces the next inspect to run even though nothing in the form changed. */
  async function recheck() {
    inspected.current = ""
    await inspect()
  }

  async function propose() {
    if (!inspection?.proposal) return

    setWorking("propose")
    setProblem(null)

    try {
      const response = await fetch("/api/projects/config-proposal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: repo.trim() }),
      })
      const payload: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        setProblem(responseMessage(payload) ?? "That pull request could not be opened.")
        return
      }

      const opened = payload as ProposedConfig
      setProposed({ number: opened.number, url: opened.url })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(null)
    }
  }

  async function create() {
    setWorking("create")
    setProblem(null)
    setFieldProblem(null)

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: repo.trim(), previewUrl: previewUrl.trim(), name: name.trim() }),
      })
      const payload: unknown = await response.json().catch(() => null)

      if (!response.ok) {
        const message = responseMessage(payload) ?? "That project could not be created."
        if (fieldError(payload) === "repo") setFieldProblem(message)
        else setProblem(message)
        return
      }

      const result = payload as CreatedProject
      setCreated(result)

      // The new project becomes the one the dashboard is looking at, so the
      // runs page it lands on is this project's.
      await onCreated(result.projectId)
      router.refresh()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setWorking(null)
    }
  }

  async function copyProposal() {
    if (!inspection?.proposal) return
    await navigator.clipboard.writeText(inspection.proposal.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const ready =
    inspection?.ok === true && repo.trim().length > 0 && previewUrl.trim().length > 0 && !inspecting

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger render={trigger as React.ReactElement} />

      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        {created ? (
          <Created result={created} onClose={() => setOpen(false)} onGo={() => router.push("/runs")} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add project</DialogTitle>
              <DialogDescription>
                Drift reads the routes, the viewports and the token file out of the repo. It
                needs to be told which repo, and where it is deployed.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="repo">Repo</Label>
                <Input
                  id="repo"
                  value={repo}
                  placeholder="owner/name"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setRepo(event.target.value)}
                  onBlur={() => void inspect()}
                />
                {fieldProblem ? (
                  <p className="text-xs leading-relaxed text-destructive">{fieldProblem}</p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="preview-url">Preview URL</Label>
                <Input
                  id="preview-url"
                  value={previewUrl}
                  placeholder="https://your-app-preview.a.run.app"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setPreviewUrl(event.target.value)}
                  onBlur={() => void inspect()}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  placeholder="What to call it in the switcher"
                  onChange={(event) => {
                    setName(event.target.value)
                    setNameEdited(true)
                  }}
                />
              </div>

              {inspecting || inspection ? (
                <>
                  <Separator />
                  {inspecting && inspection ? (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <RiLoader4Line className="size-4 animate-spin" />
                      Reading {repo.trim()}.
                    </p>
                  ) : null}
                  <Checks inspection={inspection} inspecting={inspecting} />
                </>
              ) : null}

              {inspection?.proposal ? (
                <Proposal
                  content={inspection.proposal.content}
                  path={inspection.proposal.path}
                  canPropose={inspection.canProposeConfig}
                  proposed={proposed}
                  copied={copied}
                  working={working === "propose"}
                  onCopy={() => void copyProposal()}
                  onPropose={() => void propose()}
                  onRecheck={() => void recheck()}
                  rechecking={inspecting}
                />
              ) : null}

              {inspection ? <Advisories inspection={inspection} /> : null}

              {problem ? (
                <p className="text-xs leading-relaxed text-destructive">{problem}</p>
              ) : null}
            </div>

            <DialogFooter>
              <DialogClose
                render={
                  <Button variant="ghost" size="sm">
                    Cancel
                  </Button>
                }
              />
              <Button size="sm" disabled={!ready || working !== null} onClick={() => void create()}>
                {working === "create" ? (
                  <RiLoader4Line className="animate-spin" />
                ) : null}
                Watch this project
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The four checks, in the order they were asked. */
function Checks({
  inspection,
  inspecting,
}: {
  inspection: Inspection | null
  inspecting: boolean
}) {
  if (inspecting && !inspection) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <RiLoader4Line className="size-4 animate-spin" />
        Reading the repo.
      </p>
    )
  }
  if (!inspection) return null

  return (
    <ul
      // Whatever is on screen during a re-check is the last repo's answer, not
      // this one's, so it says so rather than looking settled.
      data-checking={inspecting ? "" : undefined}
      className="flex flex-col gap-2.5 data-checking:opacity-50"
    >
      {inspection.checks.map((check) => (
        <li key={check.id} className="flex gap-2.5">
          <CheckMark status={check.status} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-xs leading-relaxed">
              <span className="text-muted-foreground">{CHECK_LABELS[check.id] ?? check.id}. </span>
              {check.message}
            </p>
            {check.remedy ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{check.remedy}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

function CheckMark({ status }: { status: CheckStatus }) {
  if (status === "pass") return <RiCheckLine className="size-4 shrink-0 text-primary" />
  if (status === "fail") return <RiCloseLine className="size-4 shrink-0 text-destructive" />
  if (status === "warn")
    return <RiErrorWarningLine className="size-4 shrink-0 text-muted-foreground" />
  return <RiSubtractLine className="size-4 shrink-0 text-muted-foreground" />
}

/** What is true of the project without being a check it can fail. */
function Advisories({ inspection }: { inspection: Inspection }) {
  const notes: string[] = []

  if (!inspection.advisories.allowlisted) {
    notes.push(
      `${inspection.repoSlug} is not on GITHUB_REPO_ALLOWLIST. Drift will render it, find drift in it and score it, and will open no pull request against it.`,
    )
  }
  if (inspection.advisories.authCookie && !inspection.advisories.authCookie.valueSet) {
    notes.push(
      `The config signs in with a cookie named ${inspection.advisories.authCookie.name}, and PREVIEW_AUTH_COOKIE_VALUE is empty. Runs will stop before the browser opens until it is set.`,
    )
  }

  if (notes.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {notes.map((note) => (
        <p key={note} className="text-xs leading-relaxed text-muted-foreground">
          {note}
        </p>
      ))}
    </div>
  )
}

/** The config Drift would write, for a repo that has none. */
function Proposal({
  content,
  path,
  canPropose,
  proposed,
  copied,
  working,
  rechecking,
  onCopy,
  onPropose,
  onRecheck,
}: {
  content: string
  path: string
  canPropose: boolean
  proposed: { number: number; url: string } | null
  copied: boolean
  working: boolean
  rechecking: boolean
  onCopy: () => void
  onPropose: () => void
  onRecheck: () => void
}) {
  return (
    <Alert>
      <AlertTitle>Drift can write that config</AlertTitle>
      <AlertDescription>
        <p>
          This is {path} as Drift would write it. It declares the root route only, because Drift
          never guesses what to render. Add the routes you want watched.
        </p>

        <pre className="max-h-48 overflow-auto bg-secondary p-3 font-mono text-xs text-foreground">
          {content}
        </pre>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onCopy}>
            <RiFileCopyLine />
            {copied ? "Copied" : "Copy the file"}
          </Button>

          {canPropose && !proposed ? (
            <Button variant="outline" size="sm" disabled={working} onClick={onPropose}>
              {working ? <RiLoader4Line className="animate-spin" /> : <RiGitPullRequestLine />}
              Open a pull request
            </Button>
          ) : null}

          <Button variant="ghost" size="sm" disabled={rechecking} onClick={onRecheck}>
            {rechecking ? <RiLoader4Line className="animate-spin" /> : null}
            Check again
          </Button>
        </div>

        {proposed ? (
          <p>
            Proposed as{" "}
            <a className="underline" href={proposed.url} target="_blank" rel="noreferrer">
              pull request #{proposed.number}
            </a>
            . Merge it, then check again.
          </p>
        ) : null}

        {!canPropose ? (
          <p className="text-muted-foreground">
            Drift cannot open that pull request, because this repo is not on
            GITHUB_REPO_ALLOWLIST. Add the file yourself and check again.
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

/** What happened, once the project exists. */
function Created({
  result,
  onClose,
  onGo,
}: {
  result: CreatedProject
  onClose: () => void
  onGo: () => void
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Watching {result.name}</DialogTitle>
        <DialogDescription>{result.repo} is now a project in this dashboard.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        {result.firstRun.started ? (
          <p className="text-xs leading-relaxed">
            Its first run is going, as execution {result.firstRun.executionId}. Screens appear on
            the runs page as they are captured.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs leading-relaxed">
              Nothing has been rendered yet. {result.firstRun.reason}
            </p>
            <pre className="overflow-x-auto bg-secondary p-3 font-mono text-xs text-foreground">
              {result.firstRun.command}
            </pre>
          </div>
        )}

        {result.configPullRequest ? (
          <p className="text-xs leading-relaxed">
            The config was proposed as{" "}
            <a
              className="underline"
              href={result.configPullRequest.url}
              target="_blank"
              rel="noreferrer"
            >
              pull request #{result.configPullRequest.number}
            </a>
            .
          </p>
        ) : null}

        {result.configPullRequestError ? (
          <p className="text-xs leading-relaxed text-destructive">
            {result.configPullRequestError}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
        <Button
          size="sm"
          onClick={() => {
            onClose()
            onGo()
          }}
        >
          Open the runs page
        </Button>
      </DialogFooter>
    </>
  )
}

/** The repo's own name, in sentence case, as a name to start from. */
function suggestName(repo: string): string {
  const name = repo.split("/")[1] ?? ""
  const words = name.split(/[-_.]+/).filter(Boolean)
  if (words.length === 0) return ""
  const [first = "", ...rest] = words
  return [(first[0]?.toUpperCase() ?? "") + first.slice(1), ...rest].join(" ")
}
