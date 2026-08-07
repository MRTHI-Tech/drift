/**
 * Choosing which captures of a screen to read.
 *
 * A run writes one `screens` document per route per viewport, so a project
 * watched for a week holds seven captures of the same page. Anything counting
 * across a set of screens, a convention's evidence or a family's copy voice,
 * has to count each page once or it counts the same page as many times as it
 * has been rendered.
 */

import type { Screen } from "../types"

/**
 * The newest capture of each route and viewport, ordered by route and then by
 * id so two callers over the same set always read them in the same order.
 */
export function latestPerRoute(screens: readonly Screen[]): Screen[] {
  const newest = new Map<string, Screen>()

  for (const screen of screens) {
    const key = `${screen.route}|${screen.viewport}`
    const held = newest.get(key)
    if (!held || screen.capturedAt.getTime() > held.capturedAt.getTime()) {
      newest.set(key, screen)
    }
  }

  return [...newest.values()].sort((left, right) =>
    left.route === right.route ? (left.id < right.id ? -1 : 1) : left.route < right.route ? -1 : 1,
  )
}
