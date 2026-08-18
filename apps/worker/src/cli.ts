#!/usr/bin/env -S node --import tsx
import { parseArgs } from "node:util"

import { githubClientFor, createRepositories, syncRulesFile } from "@drift/core"
import { chromium } from "playwright"

import { createLogger, errorMessage } from "./logger"
import { ACTIONS_LINE, parseAction, resolveCommand } from "./resolve"
import { runProject } from "./run"
import { TRIGGERS_LINE, parseTrigger } from "./trigger"

const USAGE = `drift-worker - renders a watched project's declared screens

Usage:
  pnpm worker -- run --project <id> [options]
  pnpm worker -- resolve --finding <id> --action <action> [--reason "..."]
  pnpm worker -- rules --project <id> [--dry-run]

Commands:
  run              Render every route in the project's drift.config.json.
  resolve          Resolve one finding by id. Temporary, until the dashboard
                   has a findings page.
  rules            Regenerate drift.rules.md and put it in the watched repo.

Options:
  --project <id>   Project to run. Required by run and rules.
  --route <path>   Limit the run to one route. Repeatable.
  --trigger <how>  One of: ${TRIGGERS_LINE}. What the run records as its
                   reason for starting. Defaults to manual. Cloud Scheduler
                   passes scheduled and the dashboard's deploy webhook passes
                   deploy, both as container overrides on the Cloud Run job.
  --finding <id>   Finding to resolve. Required by resolve.
  --action <name>  One of: ${ACTIONS_LINE}. Required by resolve.
  --reason <text>  Why the screen is allowed to differ. Required by exception.
  --dry-run        Work everything out, write nothing.
  --version        Print the pinned Chromium version and exit.
  --help           Print this message and exit.

The pipeline is render -> extract -> sign -> diff -> judge -> persist ->
actuate. Screens are signed and their computed styles are diffed against the
token file the config points at, which writes findings of type token without
calling a model. Judgment then classifies each screen into an archetype,
derives that archetype's conventions, and raises findings of type pattern
where a screen departs from them. Every value a model cites is checked against
the screen's own extraction record before anything is written.

Actuation runs last. A token finding that is high confidence and a single
literal substitution may open a pull request unprompted; everything else waits
for a resolution. The one function deciding which is which is isAutonomousFix
in packages/core/src/actuation/autonomy.ts, and every decision it makes is
logged with its reason. No pull request is opened against a repo that is not
on GITHUB_REPO_ALLOWLIST, whatever Firestore says.

--dry-run skips judgment and actuation along with every other write.

Needs GOOGLE_CLOUD_PROJECT, STORAGE_BUCKET, GITHUB_TOKEN, GEMINI_API_KEY,
GITHUB_REPO_ALLOWLIST, Google application default credentials, and
PREVIEW_AUTH_COOKIE_VALUE for projects whose config sets authCookieName. See
AGENTS.md section 8.
`

async function main(): Promise<number> {
  // `pnpm worker -- run` forwards the separator itself, so drop it.
  const args = process.argv.slice(2).filter((arg) => arg !== "--")

  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      project: { type: "string" },
      route: { type: "string", multiple: true },
      trigger: { type: "string" },
      finding: { type: "string" },
      action: { type: "string" },
      reason: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      version: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  })

  if (values.help) {
    console.log(USAGE)
    return 0
  }

  if (values.version) {
    const browser = await chromium.launch()
    console.log(browser.version())
    await browser.close()
    return 0
  }

  const command = positionals[0] ?? null
  const dryRun = values["dry-run"] ?? false

  switch (command) {
    case "run":
      return runCommand(values.project, values.route ?? [], values.trigger, dryRun)
    case "resolve":
      return resolve(values.finding, values.action, values.reason, dryRun)
    case "rules":
      return rules(values.project, dryRun)
    default:
      console.error(command ? `Unknown command ${command}.\n\n${USAGE}` : USAGE)
      return 1
  }
}

async function runCommand(
  project: string | undefined,
  routes: string[],
  trigger: string | undefined,
  dryRun: boolean,
): Promise<number> {
  const projectId = project?.trim()
  if (!projectId) {
    console.error(`--project is required.\n\n${USAGE}`)
    return 1
  }

  const parsedTrigger = parseTrigger(trigger)
  if (!parsedTrigger) {
    console.error(`--trigger must be one of: ${TRIGGERS_LINE}.\n\n${USAGE}`)
    return 1
  }

  const summary = await runProject({ projectId, routes, dryRun, trigger: parsedTrigger })

  // A run that lost a target is a failed command, even though its screens and
  // its runs document were both written.
  return summary.status === "error" ? 1 : 0
}

async function resolve(
  finding: string | undefined,
  action: string | undefined,
  reason: string | undefined,
  dryRun: boolean,
): Promise<number> {
  const findingId = finding?.trim()
  if (!findingId) {
    console.error(`--finding is required.\n\n${USAGE}`)
    return 1
  }

  const parsed = parseAction(action)
  if (!parsed) {
    console.error(`--action must be one of: ${ACTIONS_LINE}.\n\n${USAGE}`)
    return 1
  }

  return resolveCommand({
    findingId,
    action: parsed,
    reason,
    dryRun,
    logger: createLogger(),
  })
}

/**
 * Regenerates the rules file on demand. A resolution that moves a convention
 * already does this on its own; this is for looking at the file without
 * resolving anything.
 */
async function rules(project: string | undefined, dryRun: boolean): Promise<number> {
  const projectId = project?.trim()
  if (!projectId) {
    console.error(`--project is required.\n\n${USAGE}`)
    return 1
  }

  const repositories = createRepositories()
  const found = await repositories.projects.get(projectId)
  if (!found) {
    console.error(`There is no project ${projectId}.`)
    return 1
  }

  const result = await syncRulesFile({
    octokit: githubClientFor(found.installationId),
    project: found,
    repositories,
    logger: createLogger({ projectId }),
    dryRun,
  })

  console.log(
    dryRun
      ? result.content
      : `${result.path} on ${result.branch}: ${result.changed ? "updated" : "unchanged"}` +
          `${result.prNumber ? `, proposed as pull request ${result.prNumber}` : ""}.`,
  )
  return 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    // runProject already wrote the runs document. This is the last word.
    createLogger().error("worker.error", { message: errorMessage(error) })
    process.exitCode = 1
  },
)
