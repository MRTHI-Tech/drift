/**
 * Creates one watched project document from CLI arguments.
 *
 *   pnpm --filter @drift/core seed -- \
 *     --name "Acme" --repo "acme/web" --preview-url "https://acme-preview.run.app"
 *
 * Needs GOOGLE_CLOUD_PROJECT and Google application default credentials.
 * Writes nothing else: no runs, no screens, no findings.
 */
import { parseArgs } from "node:util"

import { DEFAULT_BRANCH, DEFAULT_CONFIG_PATH } from "../src/constants"
import { createProjectRepository } from "../src/repositories/projects"
import { getDriftFirestore } from "../src/firestore"
import type { Project } from "../src/types"

const USAGE = `Usage: seed --name <name> --repo <owner/name> --preview-url <url>
             [--default-branch <branch>] [--config-path <path>]`

const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      repo: { type: "string" },
      "preview-url": { type: "string" },
      "default-branch": { type: "string", default: DEFAULT_BRANCH },
      "config-path": { type: "string", default: DEFAULT_CONFIG_PATH },
    },
  })

  const name = required(values.name, "--name")
  const repo = required(values.repo, "--repo")
  const previewUrl = required(values["preview-url"], "--preview-url")

  if (!REPO_PATTERN.test(repo)) {
    fail(`--repo must be owner/name. Got ${repo}.`)
  }
  assertHttpUrl(previewUrl)

  const projects = createProjectRepository(getDriftFirestore())

  const existing = await projects.findByRepo(repo)
  if (existing) {
    fail(`A project already watches ${repo}: ${existing.id}. Nothing was written.`)
  }

  const input: Omit<Project, "id"> = {
    name,
    repo,
    previewUrl,
    defaultBranch: values["default-branch"] ?? DEFAULT_BRANCH,
    configPath: values["config-path"] ?? DEFAULT_CONFIG_PATH,
    createdAt: new Date(),
    driftScore: 0,
    lastRunAt: null,
  }

  const project = await projects.create(input)

  console.log({
    message: "Created project",
    collection: "projects",
    projectId: project.id,
    name: project.name,
    repo: project.repo,
    previewUrl: project.previewUrl,
  })
}

function required(value: string | undefined, flag: string): string {
  if (!value || value.trim().length === 0) {
    fail(`${flag} is required.\n${USAGE}`)
  }
  return value.trim()
}

function assertHttpUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    fail(`--preview-url must be a URL. Got ${value}.`)
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    fail(`--preview-url must be http or https. Got ${url.protocol}.`)
  }
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

await main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
