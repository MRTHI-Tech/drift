import { readFile } from "node:fs/promises"

import { z } from "zod"

import { VIEWPORTS } from "./constants"

/**
 * Schema for a watched project's `drift.config.json`. The file lives in the
 * watched repo at the project's `configPath`. Routes are always declared here;
 * Drift never crawls (AGENTS.md section 9).
 */
export const driftConfigSchema = z
  .object({
    /** Routes to render, each an absolute path on the preview URL. */
    routes: z
      .array(
        z
          .string()
          .min(1)
          .startsWith("/", "Every route must start with /"),
      )
      .min(1, "At least one route is required")
      .refine((routes) => new Set(routes).size === routes.length, {
        message: "Routes must be unique",
      }),
    /** Viewports to render each route at. */
    viewports: z
      .array(z.enum(VIEWPORTS))
      .min(1, "At least one viewport is required")
      .refine((viewports) => new Set(viewports).size === viewports.length, {
        message: "Viewports must be unique",
      })
      .default([...VIEWPORTS]),
    /** Name of the session cookie the render worker sets to reach signed-in routes. */
    authCookieName: z.string().min(1).nullable().default(null),
    /** Whether the watched app needs its demo data seeded before a run. */
    seedData: z.boolean().default(false),
    /** Repo-relative path to the file that defines the design tokens. */
    tokenDefinitionsPath: z.string().min(1).nullable().default(null),
  })
  .strict()

export type DriftConfig = z.infer<typeof driftConfigSchema>

/** Parses an already-decoded config value. Throws on anything malformed. */
export function parseDriftConfig(value: unknown): DriftConfig {
  const result = driftConfigSchema.safeParse(value)
  if (!result.success) {
    throw new DriftConfigError(formatIssues(result.error))
  }
  return result.data
}

/** Reads and parses a `drift.config.json` from disk. */
export async function loadDriftConfig(path: string): Promise<DriftConfig> {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (cause) {
    throw new DriftConfigError(`Could not read the config at ${path}`, { cause })
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw new DriftConfigError(`The config at ${path} is not valid JSON`, { cause })
  }

  try {
    return parseDriftConfig(value)
  } catch (cause) {
    if (cause instanceof DriftConfigError) {
      throw new DriftConfigError(`The config at ${path} is not valid. ${cause.message}`, { cause })
    }
    throw cause
  }
}

/** Raised when a config cannot be read, decoded, or validated. */
export class DriftConfigError extends Error {
  override readonly name = "DriftConfigError"
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".")
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message
    })
    .join("; ")
}
