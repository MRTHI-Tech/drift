/**
 * Where a screenshot lands in the bucket. Deterministic from the run, so a
 * screen document's `screenshotPath` can be rebuilt from its own fields.
 */
import { createHash } from "node:crypto"

import type { Viewport } from "@drift/core"

export interface ScreenshotPathInput {
  projectId: string
  runId: string
  route: string
  viewport: Viewport
}

/**
 * `screens/{projectId}/{runId}/{slug}-{hash}-{viewport}.png`.
 *
 * The slug is for a human reading the bucket; the hash is what makes the name
 * unique, because `/a/b` and `/a-b` slugify the same way.
 */
export function screenshotObjectPath(input: ScreenshotPathInput): string {
  const slug = slugifyRoute(input.route)
  const hash = createHash("sha256").update(input.route, "utf8").digest("hex").slice(0, 8)
  return `screens/${input.projectId}/${input.runId}/${slug}-${hash}-${input.viewport}.png`
}

/** A route as a filename part: lowercase, dashes only, never empty. */
export function slugifyRoute(route: string): string {
  const slug = route
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "")
  return slug.length > 0 ? slug : "index"
}
