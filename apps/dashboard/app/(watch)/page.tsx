/**
 * The dashboard opens on the runs feed: what Drift did last is the first thing
 * a person wants when they come back to it.
 */

import { redirect } from "next/navigation"

export default function IndexPage() {
  redirect("/runs")
}
