import { createHash } from "node:crypto";
import {
  HuntDocumentSchema,
  canonicalJson,
  checkImmutability,
  type ContentIssue,
  type ContentRelease,
} from "@signal-hunt/content-tools";
import { and, eq } from "drizzle-orm";
import type { DatabaseHandle, Db } from "../../infrastructure/db/client";
import { cacheVerifiers, huntVersions, hunts } from "../../infrastructure/db/schema";

export type RegisterResult =
  { ok: true; registeredVersions: number; hunts: number } | { ok: false; issues: ContentIssue[] };

/**
 * Deployment-time registration of a validated release. Runs in one transaction: either every new
 * immutable version and all availability metadata are applied, or nothing changes. Existing
 * versions are never modified or removed, so pinned runs keep their content.
 */
export function registerRelease(database: DatabaseHandle, release: ContentRelease, now: number): RegisterResult {
  return database.db.transaction(
    (tx) => {
      const registered = tx
        .select({ huntId: huntVersions.huntId, version: huntVersions.version, digest: huntVersions.digest })
        .from(huntVersions)
        .all();
      const issues = checkImmutability(registered, release);
      if (issues.length > 0) return { ok: false as const, issues };

      const known = new Set(registered.map((row) => `${row.huntId}@${row.version}`));
      let registeredVersions = 0;
      for (const hunt of release.hunts) {
        const metadata = {
          currentVersion: hunt.currentVersion,
          available: hunt.available,
          unavailableReason: hunt.unavailableReason,
          updatedAt: now,
        };
        tx.insert(hunts)
          .values({ id: hunt.huntId, ...metadata })
          .onConflictDoUpdate({ target: hunts.id, set: metadata })
          .run();
        for (const version of hunt.versions) {
          if (known.has(`${version.huntId}@${version.version}`)) continue;
          tx.insert(huntVersions)
            .values({
              huntId: version.huntId,
              version: version.version,
              digest: version.digest,
              document: JSON.stringify(version.document),
              registeredAt: now,
            })
            .run();
          if (version.cacheVerifier) {
            tx.insert(cacheVerifiers)
              .values({ huntId: version.huntId, version: version.version, ...version.cacheVerifier })
              .run();
          }
          registeredVersions += 1;
        }
      }
      return { ok: true as const, registeredVersions, hunts: release.hunts.length };
    },
    { behavior: "immediate" },
  );
}

/**
 * Readiness check: at least one hunt is registered, every stored document parses and still
 * matches its digest, every QR hunt has its verifier, and every hunt's current version exists.
 */
export function verifyRegisteredContent(db: Db): boolean {
  const huntRows = db.select().from(hunts).all();
  if (huntRows.length === 0) return false;
  const versionRows = db.select().from(huntVersions).all();
  const present = new Set<string>();
  for (const row of versionRows) {
    let parsed;
    try {
      parsed = HuntDocumentSchema.safeParse(JSON.parse(row.document));
    } catch {
      return false;
    }
    if (!parsed.success) return false;
    const verifier = db
      .select({ checkpointId: cacheVerifiers.checkpointId, tokenHash: cacheVerifiers.tokenHash })
      .from(cacheVerifiers)
      .where(and(eq(cacheVerifiers.huntId, row.huntId), eq(cacheVerifiers.version, row.version)))
      .get();
    if ((parsed.data.finale.type === "qr") !== (verifier !== undefined)) return false;
    const digest = createHash("sha256")
      .update(canonicalJson({ document: parsed.data, cacheVerifier: verifier ?? null }), "utf8")
      .digest("hex");
    if (digest !== row.digest) return false;
    present.add(`${row.huntId}@${row.version}`);
  }
  return huntRows.every((hunt) => present.has(`${hunt.id}@${hunt.currentVersion}`));
}
