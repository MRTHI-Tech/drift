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

const nextConfig: NextConfig = {
  // @drift/core is consumed as TypeScript source, not as a built package.
  transpilePackages: ["@drift/core"],
}

export default nextConfig
