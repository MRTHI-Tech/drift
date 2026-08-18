/**
 * Creates one watched project document from CLI arguments.
 *
 *   pnpm --filter @drift/core seed -- \
 *     --name "Acme" --repo "acme/web" --preview-url "https://acme-preview.run.app"
 *
 * Needs GOOGLE_CLOUD_PROJECT and Google application default credentials.
 * Writes nothing else: no runs, no screens, no findings.
 *
 * The work is `createProject` in `src/projects/`, which is also what the
 * dashboard's add dialog calls. Nothing about a project differs by where it was
 * created from, and this file exists to turn flags into that call and errors
 * into an exit code.
 *
 * What it does not do is check the repo first. The dashboard inspects before it
 * creates, because somebody is sitting there and can fix a typo; a terminal
 * command that reaches GitHub before writing would be slower and would fail on
 * a machine with no network for a document that does not need one.
 */
import { parseArgs } from "node:util"

import { DEFAULT_BRANCH, DEFAULT_CONFIG_PATH } from "../src/constants"
import {
  createProject,
  ProjectExistsError,
  ProjectInputError,
  workerCommand,
} from "../src/projects"
import { createRepositories } from "../src/repositories"

const USAGE = `Usage: seed --name <name> --repo <owner/name> --preview-url <url>
             --user <uid> [--default-branch <branch>] [--config-path <path>]`

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      repo: { type: "string" },
      "preview-url": { type: "string" },
      "default-branch": { type: "string", default: DEFAULT_BRANCH },
      "config-path": { type: "string", default: DEFAULT_CONFIG_PATH },
      user: { type: "string" },
    },
  })

  if (!values.user) {
    console.error(
      "Seeding needs --user <uid>: a project belongs to the account that made it.\n" +
        "The uid is in the dashboard's sign-in, or in the Firebase console under Authentication.",
    )
    process.exitCode = 1
    return
  }

  const project = await createProject({
    input: {
      userId: values.user,
      name: values.name ?? "",
      repo: values.repo ?? "",
      previewUrl: values["preview-url"] ?? "",
      defaultBranch: values["default-branch"],
      configPath: values["config-path"],
    },
    repositories: createRepositories(),
  })

  console.log({
    message: "Created project",
    collection: "projects",
    projectId: project.id,
    name: project.name,
    repo: project.repo,
    previewUrl: project.previewUrl,
    next: workerCommand(project.id),
  })
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

await main().catch((error: unknown) => {
  if (error instanceof ProjectInputError) {
    fail(`${error.issues.map((issue) => issue.message).join("\n")}\n\n${USAGE}`)
  }
  if (error instanceof ProjectExistsError) {
    fail(`${error.message} Nothing was written.`)
  }
  fail(error instanceof Error ? error.message : String(error))
})
