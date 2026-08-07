#!/usr/bin/env -S node --import tsx
import { parseArgs } from "node:util"

import { chromium } from "playwright"

import { createLogger, errorMessage } from "./logger"
import { runProject } from "./run"

const USAGE = `drift-worker - renders a watched project's declared screens

Usage:
  pnpm worker -- run --project <id> [options]

Commands:
  run              Render every route in the project's drift.config.json.

Options:
  --project <id>   Project to run. Required by run.
  --route <path>   Limit the run to one route. Repeatable.
  --dry-run        Render and extract, write nothing.
  --version        Print the pinned Chromium version and exit.
  --help           Print this message and exit.

The pipeline is render -> extract -> sign -> diff -> judge -> persist. This
phase covers everything except judge: screens are signed, their computed
styles are diffed against the token file the config points at, and off-token
values are written as findings of type token. No model is called.

Needs GOOGLE_CLOUD_PROJECT, STORAGE_BUCKET, GITHUB_TOKEN, Google application
default credentials, and PREVIEW_AUTH_COOKIE_VALUE for projects whose config
sets authCookieName. See AGENTS.md section 8.
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
  if (command !== "run") {
    console.error(command ? `Unknown command ${command}.\n\n${USAGE}` : USAGE)
    return 1
  }

  const projectId = values.project?.trim()
  if (!projectId) {
    console.error(`--project is required.\n\n${USAGE}`)
    return 1
  }

  const summary = await runProject({
    projectId,
    routes: values.route ?? [],
    dryRun: values["dry-run"] ?? false,
    trigger: "manual",
  })

  // A run that lost a target is a failed command, even though its screens and
  // its runs document were both written.
  return summary.status === "error" ? 1 : 0
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
