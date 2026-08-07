"use server"

/**
 * Choosing which project the dashboard is looking at.
 *
 * A server action rather than a cookie written in the browser: the choice is
 * read on the server by every page, so it is set on the server too, and the
 * cookie never has to be readable by a script.
 */

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

import { PROJECT_COOKIE, repositories } from "@/lib/data/workspace"
import { requireSession } from "@/lib/session"

/** A year: a project choice should outlive a session. */
const CHOICE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

export async function chooseProject(projectId: string): Promise<void> {
  await requireSession()

  // Only a project that exists. A cookie naming anything else would send every
  // page back to the first project without saying why.
  const project = await repositories().projects.get(projectId)
  if (!project) return

  const store = await cookies()
  store.set(PROJECT_COOKIE, project.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CHOICE_MAX_AGE_SECONDS,
  })

  revalidatePath("/", "layout")
}
