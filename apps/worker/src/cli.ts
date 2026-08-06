#!/usr/bin/env -S node --import tsx
import { parseArgs } from "node:util"

import { chromium } from "playwright"

const USAGE = `drift-worker - renders a watched project and reports drift

Usage:
  pnpm worker -- [options]

Options:
  --project <id>   Project to run. Required once runs are wired up.
  --route <path>   Limit the run to a single route. Repeatable.
  --dry-run        Render and extract, write nothing.
  --version        Print the pinned Chromium version and exit.
  --help           Print this message and exit.

The pipeline is render -> extract -> sign -> diff -> judge -> persist. Nothing
past the browser check is implemented yet.
`

interface WorkerOptions {
  project: string | null
  routes: string[]
  dryRun: boolean
}

function log(phase: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ phase, ...fields }))
}

async function run(options: WorkerOptions): Promise<void> {
  log("run.start", {
    projectId: options.project,
    routes: options.routes,
    dryRun: options.dryRun,
  })

  const browser = await chromium.launch()
  try {
    log("render.browser_ready", { chromium: browser.version() })
  } finally {
    await browser.close()
  }

  log("run.finish", { status: "clean", routesChecked: 0 })
}

async function main(): Promise<number> {
  // `pnpm worker -- --help` forwards the separator itself, so drop it.
  const args = process.argv.slice(2).filter((arg) => arg !== "--")

  const { values } = parseArgs({
    args,
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

  await run({
    project: values.project ?? null,
    routes: values.route ?? [],
    dryRun: values["dry-run"] ?? false,
  })

  return 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    // A run never dies silently. Later phases also write a runs document here.
    log("run.error", {
      message: error instanceof Error ? error.message : String(error),
    })
    process.exitCode = 1
  }
)
