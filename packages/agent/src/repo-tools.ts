/**
 * What the Fixer can find out about a watched repo, as pure functions over the
 * files it was given.
 *
 * The Fixer is the one part of Drift that reads somebody else's code, so what
 * it can see is worth being precise about. It sees a fixed set of files,
 * fetched once by `fetchSourceFiles` before the flow starts, already filtered
 * to source by `isSourcePath` and already capped by size and count. There is no
 * network here and no path that reaches one: a tool cannot open a file that was
 * not in the set, cannot walk out of the repo, and cannot see the same repo
 * twice in two different states partway through a fix.
 *
 * Everything is a pure function of that array, which is the reason this module
 * is separate from the flow that wraps it. The tools a model calls are the part
 * most likely to be wrong in a way no prompt reveals, so they are tested
 * directly, without a model in the loop.
 */

import type { SourceFile } from "@drift/core"

import { MAX_READ_LINES, MAX_SEARCH_HITS } from "./constants"

/** One line a search matched. */
export interface RepoSearchHit {
  path: string
  /** 1-indexed, so it reads the way an editor reads. */
  line: number
  text: string
}

/**
 * Every line holding `query`, as a literal rather than a pattern, matched
 * without regard to case because a colour written `#FF0000` in a screen's
 * computed styles is written `#ff0000` about half the time in source.
 *
 * Capped, and the cap is reported rather than hidden: a query matching more
 * than `MAX_SEARCH_HITS` lines is a query about the wrong thing, and the Fixer
 * is better off being told that than being handed the first thirty of them as
 * though they were all of them.
 */
export function searchRepo(
  files: readonly SourceFile[],
  query: string,
  limit: number = MAX_SEARCH_HITS,
): { hits: RepoSearchHit[]; total: number; truncated: boolean } {
  const needle = query.toLowerCase()
  if (needle.length === 0) return { hits: [], total: 0, truncated: false }

  const hits: RepoSearchHit[] = []
  let total = 0

  for (const file of files) {
    const lines = file.text.split("\n")
    for (const [index, line] of lines.entries()) {
      if (!line.toLowerCase().includes(needle)) continue
      total += 1
      if (hits.length < limit) {
        hits.push({ path: file.path, line: index + 1, text: line.trimEnd() })
      }
    }
  }

  return { hits, total, truncated: total > hits.length }
}

/** One file, or the part of it that was asked for. */
export interface RepoFileSlice {
  path: string
  /** 1-indexed and inclusive. */
  from: number
  to: number
  /** Lines in the whole file, so the Fixer knows what it has not seen. */
  total: number
  /**
   * The text exactly as the file holds it, unnumbered and unaltered. The fix
   * gate matches what the Fixer quotes character for character, so anything
   * added here to make the text easier to read would make it impossible to
   * quote.
   */
  text: string
}

/**
 * A file's contents, or a window onto them. Null when the path is not one of
 * the files the Fixer was given, which is the same answer the fix gate gives
 * to an edit naming such a path.
 */
export function readRepoFile(
  files: readonly SourceFile[],
  path: string,
  from = 1,
  to?: number,
): RepoFileSlice | null {
  const file = files.find((candidate) => candidate.path === path)
  if (!file) return null

  const lines = file.text.split("\n")
  const start = Math.max(1, Math.trunc(from))
  const end = Math.min(lines.length, to === undefined ? start + MAX_READ_LINES - 1 : Math.trunc(to))
  const last = Math.min(end, start + MAX_READ_LINES - 1)

  return {
    path: file.path,
    from: start,
    to: Math.max(start, last),
    total: lines.length,
    text: lines.slice(start - 1, last).join("\n"),
  }
}

/** Every path the Fixer was given, optionally narrowed to one prefix. */
export function listRepoFiles(files: readonly SourceFile[], prefix = ""): string[] {
  return files
    .map((file) => file.path)
    .filter((path) => path.startsWith(prefix))
    .sort()
}
