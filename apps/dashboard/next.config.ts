import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { loadEnvFile } from "node:process"
import type { NextConfig } from "next"

// The env file is one file for the whole repo (`.env.local` at the root,
// gitignored, canonical list in AGENTS.md section 8). The worker reads it with
// `--env-file-if-exists`; Next only looks inside the app directory, so it is
// loaded here instead of copied. Anything already in the environment wins, so a
// deployed Cloud Run service reading Secret Manager is unaffected.
const rootEnv = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.env.local"
)
if (existsSync(rootEnv)) {
  loadEnvFile(rootEnv)
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

const nextConfig: NextConfig = {
  // @drift/core is consumed as TypeScript source, not as a built package.
  transpilePackages: ["@drift/core"],

  // The Cloud Run image runs `.next/standalone/apps/dashboard/server.js` with
  // no `node_modules` install of its own, so the build has to work out which
  // files the server actually needs and copy them. Tracing starts at the
  // monorepo root rather than at this app, because `@drift/core` and the parts
  // of `node_modules` pnpm links it through both sit above this directory.
  output: "standalone",
  outputFileTracingRoot: repoRoot,
}

export default nextConfig
