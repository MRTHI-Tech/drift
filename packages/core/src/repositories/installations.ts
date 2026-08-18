/**
 * Who connected which GitHub App installation.
 *
 * The only collection whose documents are keyed by something GitHub chose: the
 * document id is the installation id, so connecting the same installation
 * twice replaces one document rather than growing a second (AGENTS.md
 * section 2).
 *
 * What an installation reaches is never stored here. That is GitHub's to
 * answer and it changes without Drift being told, so this holds the one fact
 * GitHub cannot answer: which Drift account the grant belongs to.
 */

import type { Firestore } from "firebase-admin/firestore"

import { COLLECTIONS } from "../constants"
import type { Installation } from "../types"
import { createBaseRepository, readAll, type BaseRepository } from "./base"

export interface InstallationRepository extends BaseRepository<Installation> {
  /** Every installation this person has connected, oldest first. */
  listForUser(userId: string): Promise<Installation[]>
  /** Records the link, replacing any earlier one for the same installation. */
  connect(input: {
    installationId: number
    userId: string
    account: string
  }): Promise<Installation>
}

export function createInstallationRepository(db: Firestore): InstallationRepository {
  const base = createBaseRepository<Installation>(db, COLLECTIONS.installations)

  return {
    ...base,

    async listForUser(userId) {
      return readAll<Installation>(
        base.collection.where("userId", "==", userId).orderBy("connectedAt", "asc"),
      )
    },

    async connect({ installationId, userId, account }) {
      // Keyed by the installation id, so somebody who removes the app and
      // installs it again does not leave a stale row claiming the old grant.
      return base.create(
        { installationId, userId, account, connectedAt: new Date() },
        String(installationId),
      )
    },
  }
}
