/**
 * What a run renders: one target per declared route per declared viewport.
 * Routes come from `drift.config.json` and nowhere else; Drift never crawls
 * (AGENTS.md section 9).
 */
import type { DriftConfig, Viewport } from "@drift/core"

/** One route at one viewport: the unit a run isolates errors around. */
export interface RenderTarget {
  route: string
  viewport: Viewport
}

/** Config order, route-major, so a run's logs read top to bottom by route. */
export function buildTargets(config: Pick<DriftConfig, "routes" | "viewports">): RenderTarget[] {
  return config.routes.flatMap((route) =>
    config.viewports.map((viewport) => ({ route, viewport })),
  )
}

/** Keeps only the routes asked for. An empty filter keeps everything. */
export function filterTargets(targets: RenderTarget[], routes: string[]): RenderTarget[] {
  if (routes.length === 0) return targets
  const wanted = new Set(routes)
  return targets.filter((target) => wanted.has(target.route))
}

/**
 * The absolute URL a target renders. Routes are absolute paths, so they are
 * appended to the preview URL rather than resolved against it: a preview URL
 * that carries a base path keeps it.
 */
export function targetUrl(previewUrl: string, route: string): string {
  const base = previewUrl.replace(/\/+$/, "")
  const url = `${base}${route}`
  assertHttpUrl(url)
  return url
}

/** A human-readable target, for log fields and error messages. */
export function describeTarget(target: RenderTarget): string {
  return `${target.route} (${target.viewport})`
}

function assertHttpUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${value} is not a URL. Check the project's preview URL.`)
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${value} must be http or https.`)
  }
}
