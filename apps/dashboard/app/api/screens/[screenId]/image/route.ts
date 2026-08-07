/**
 * A captured screen, streamed out of Cloud Storage.
 *
 * The bucket is private and stays private: the browser never gets a signed URL
 * or a bucket name, it gets this route, which checks the session first and then
 * reads the object at the `screenshotPath` the `screens` document holds. The
 * caller names a screen id, never a path, so nothing here can be pointed at an
 * object the screen does not own.
 */

import { downloadScreenshot } from "@drift/core"

import { repositories } from "@/lib/data/workspace"
import { requireApiSession } from "@/lib/session"

// firebase-admin needs Node, not the edge runtime.
export const runtime = "nodejs"

export async function GET(
  _request: Request,
  context: { params: Promise<{ screenId: string }> }
): Promise<Response> {
  const gate = await requireApiSession()
  if (gate.response) return gate.response

  const { screenId } = await context.params
  const screen = await repositories().screens.get(screenId)

  if (!screen) {
    return Response.json(
      { error: `There is no screen ${screenId}.` },
      { status: 404 }
    )
  }

  let body: Buffer
  try {
    body = await downloadScreenshot(screen.screenshotPath)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    )
  }

  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "image/png",
      // A capture never changes: a new render writes a new screen document with
      // a new id. Private, because the bytes are a picture of somebody's
      // signed-in product.
      "cache-control": "private, max-age=31536000, immutable",
    },
  })
}
