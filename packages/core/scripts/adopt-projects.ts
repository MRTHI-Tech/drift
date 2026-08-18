/**
 * Gives every ownerless project an owner.
 *
 * Projects gained a `userId` when accounts were separated (AGENTS.md section
 * 9). Every project created before that has none, which makes it invisible to
 * the dashboard — and, because a repo may only be watched once, an invisible
 * project still blocks its repo from being added again. So an unadopted
 * project is not merely hidden; it is a dead end.
 *
 * Reports and writes nothing unless `--apply` is given.
 *
 *   pnpm adopt-projects --user <uid>
 *   pnpm adopt-projects --user <uid> --apply
 *
 * The uid is the one the dashboard signs you in as. Needs
 * GOOGLE_CLOUD_PROJECT and Google application default credentials.
 */
import { parseArgs } from "node:util"

import { getDriftFirestore } from "../src/firestore"
import { createRepositories } from "../src/repositories"

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      user: { type: "string" },
      apply: { type: "boolean", default: false },
    },
  })

  if (!values.user) {
    console.error("Usage: adopt-projects --user <uid> [--apply]")
    process.exitCode = 1
    return
  }

  const repositories = createRepositories(getDriftFirestore())
  const projects = await repositories.projects.list()
  const orphans = projects.filter((project) => !project.userId)

  if (orphans.length === 0) {
    console.log(`Every one of the ${projects.length} projects already has an owner.`)
    return
  }

  console.log(`${orphans.length} of ${projects.length} projects have no owner:`)
  for (const project of orphans) {
    console.log(`  ${project.name} (${project.repo})`)
  }

  if (!values.apply) {
    console.log(`\nNothing written. Re-run with --apply to give them to ${values.user}.`)
    return
  }

  for (const project of orphans) {
    await repositories.projects.update(project.id, { userId: values.user })
    console.log(`  adopted ${project.repo}`)
  }
  console.log(`\n${orphans.length} adopted by ${values.user}.`)
}

await main()
