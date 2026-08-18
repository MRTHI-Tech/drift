/**
 * Proves no door was left with only one lock on it.
 *
 * Every route handler asks whether somebody is signed in. The thing that is
 * easy to forget is the second question — is this theirs — and forgetting it
 * is invisible: nothing looks wrong, no type fails, and the only way to find
 * out is for a stranger to read a document that was not theirs.
 *
 * So this walks every route under app/api and insists each one either goes
 * through lib/ownership, or is named here as a route that deliberately does
 * not. A new route is caught by being neither.
 *
 *   node scripts/check-ownership.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/** Routes that legitimately never touch one person's data. Each needs a reason. */
const EXEMPT = new Map([
  ["app/api/auth/session/route.ts", "Mints the session cookie. There is no session yet to own anything."],
  ["app/api/pubsub/deploy/route.ts", "Google-to-Google. Verifies a signed identity token instead of a cookie; belongs to no person."],
  ["app/api/github/callback/route.ts", "Records which account a new installation belongs to. Reads its own session, owns nothing yet."],
  ["app/api/projects/inspect/route.ts", "Reads a repo on GitHub. Touches no Drift document."],
  ["app/api/projects/config-proposal/route.ts", "Writes to GitHub against a repo the caller's own installation grants."],
  ["app/api/projects/route.ts", "Creates. Stamps the session's uid; there is nothing yet to own."],
])

const ROOT = new URL("..", import.meta.url).pathname
const API = join(ROOT, "app/api")

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : full.endsWith("route.ts") ? [full] : []
  })
}

/**
 * Whether a file checks ownership itself, or hands off to something that does.
 *
 * Most routes here are three lines that call a shared handler, so following
 * the `@/lib/...` imports one step is the difference between this check being
 * useful and it being a list of exemptions that swallows the real answer.
 */
function gatedBy(source, depth = 0) {
  if (source.includes("@/lib/ownership")) return true
  if (depth > 1) return false

  return [...source.matchAll(/from "@\/(lib\/[\w./-]+)"/g)].some((match) => {
    for (const suffix of [".ts", ".tsx", "/index.ts"]) {
      const target = join(ROOT, match[1] + suffix)
      try {
        return gatedBy(readFileSync(target, "utf8"), depth + 1)
      } catch {
        continue
      }
    }
    return false
  })
}

const problems = []
for (const file of walk(API)) {
  const rel = file.slice(ROOT.length).replace(/^\/+/, "")
  const source = readFileSync(file, "utf8")
  const gated = gatedBy(source)
  const exempt = EXEMPT.has(rel)

  if (gated && exempt) {
    problems.push(`${rel}\n    is listed as exempt but does check ownership. Take it off the list.`)
  }
  if (!gated && !exempt) {
    problems.push(
      `${rel}\n    reads or writes without checking ownership, directly or through a shared handler.\n` +
        `    Add the check, or add it to EXEMPT in this file with the reason it needs none.`,
    )
  }
}

// The shared handlers behind several routes each. They carry the check for
// their routes, so if one of these loses it, several doors open at once.
for (const shared of ["lib/resolutions.ts", "lib/convention-actions.ts"]) {
  if (!readFileSync(join(ROOT, shared), "utf8").includes("@/lib/ownership")) {
    problems.push(`${shared}\n    is the shared body of several routes and no longer checks ownership.`)
  }
}

if (problems.length > 0) {
  console.error(`Ownership check failed:\n\n${problems.join("\n\n")}\n`)
  process.exit(1)
}
console.log("Ownership check passed: every route is gated or named as exempt.")
