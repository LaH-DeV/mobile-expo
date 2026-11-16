import {
  CREDENTIAL_PATTERN,
  RETENTION,
  type DeletionReceiptResponse,
  type DeletionStatusResponse,
  type MeResponse,
  type ProvisionInstallationResponse,
} from "@signal-hunt/contracts";
import { and, eq, lt, sql } from "drizzle-orm";
import type { AppContext } from "../../infrastructure/context";
import type { Db } from "../../infrastructure/db/client";
import { deletionReceipts, installations, runs } from "../../infrastructure/db/schema";
import { AppError } from "../../infrastructure/errors";
import { purgeOperationsBefore } from "../../infrastructure/idempotency";

export const INACTIVITY_EXPIRY_MS = RETENTION.inactivityExpiryDays * 24 * 60 * 60 * 1000;
const ACTIVITY_TOUCH_INTERVAL_MS = 60_000;

export type Installation = typeof installations.$inferSelect;

const iso = (ms: number) => new Date(ms).toISOString();

export function provisionInstallation(ctx: AppContext): ProvisionInstallationResponse {
  const now = ctx.clock.now();
  const credential = `sh1_${ctx.random.token(32)}`;
  const id = `ins_${ctx.random.token(16)}`;
  ctx.database.db
    .insert(installations)
    .values({
      id,
      credentialHash: ctx.hasher.verifier("credential", credential),
      lifecycleRevision: 0,
      createdAt: now,
      lastActiveAt: now,
    })
    .run();
  return {
    installationId: id,
    credential,
    installationRevision: 0,
    inactivityExpiresAt: iso(now + INACTIVITY_EXPIRY_MS),
  };
}

/**
 * Verifies a bearer credential. Authenticated use counts as activity. An installation inactive
 * for 180 days is deleted here, at the API boundary, instead of being revived.
 */
export function authenticate(ctx: AppContext, authorization: string | undefined): Installation {
  const match = /^Bearer (\S+)$/.exec(authorization ?? "");
  const credential = match?.[1];
  if (!credential || !CREDENTIAL_PATTERN.test(credential)) throw new AppError("CREDENTIAL_INVALID");
  const db = ctx.database.db;
  const now = ctx.clock.now();
  const installation = db
    .select()
    .from(installations)
    .where(eq(installations.credentialHash, ctx.hasher.verifier("credential", credential)))
    .get();
  if (!installation) throw new AppError("CREDENTIAL_INVALID");
  if (now - installation.lastActiveAt > INACTIVITY_EXPIRY_MS) {
    db.transaction((tx) => deleteInstallation(tx, installation.id, now), { behavior: "immediate" });
    throw new AppError("INSTALLATION_EXPIRED");
  }
  if (now - installation.lastActiveAt >= ACTIVITY_TOUCH_INTERVAL_MS) {
    db.update(installations).set({ lastActiveAt: now }).where(eq(installations.id, installation.id)).run();
    installation.lastActiveAt = now;
  }
  return installation;
}

export function getMe(ctx: AppContext, installation: Installation): MeResponse {
  const active = ctx.database.db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.installationId, installation.id), eq(runs.state, "active")))
    .get();
  return {
    installationId: installation.id,
    installationRevision: installation.lifecycleRevision,
    activeRunId: active?.id ?? null,
    createdAt: iso(installation.createdAt),
    inactivityExpiresAt: iso(installation.lastActiveAt + INACTIVITY_EXPIRY_MS),
  };
}

export function getLifecycleRevision(db: Db, installationId: string): number {
  const row = db
    .select({ revision: installations.lifecycleRevision })
    .from(installations)
    .where(eq(installations.id, installationId))
    .get();
  if (!row) throw new AppError("CREDENTIAL_INVALID");
  return row.revision;
}

export function bumpLifecycleRevision(db: Db, installationId: string): number {
  const row = db
    .update(installations)
    .set({ lifecycleRevision: sql`${installations.lifecycleRevision} + 1` })
    .where(eq(installations.id, installationId))
    .returning({ revision: installations.lifecycleRevision })
    .get();
  if (!row) throw new AppError("CREDENTIAL_INVALID");
  return row.revision;
}

/**
 * Deletes an installation with everything that cascades from it (runs, selections, operations)
 * and completes its deletion receipts, detaching them from the removed identity.
 */
export function deleteInstallation(tx: Db, installationId: string, now: number): void {
  tx.update(deletionReceipts)
    .set({ status: "completed", completedAt: now, installationId: null })
    .where(eq(deletionReceipts.installationId, installationId))
    .run();
  tx.delete(installations).where(eq(installations.id, installationId)).run();
}

// --- Deletion receipts ------------------------------------------------------------------------

function toStatus(receipt: typeof deletionReceipts.$inferSelect): DeletionStatusResponse {
  return {
    receiptId: receipt.id,
    status: receipt.status,
    requestedAt: iso(receipt.createdAt),
    completedAt: receipt.completedAt === null ? null : iso(receipt.completedAt),
  };
}

/**
 * Issues a fresh receipt and invalidates any earlier pending one, so repeating this call after
 * a lost response is safe: the proof the client never received simply stops working.
 */
export function createDeletionReceipt(ctx: AppContext, installation: Installation): DeletionReceiptResponse {
  const now = ctx.clock.now();
  const receiptId = `del_${ctx.random.token(16)}`;
  const receiptProof = `shd1_${ctx.random.token(32)}`;
  const expiresAt = now + ctx.config.deletionReceiptPendingMs;
  ctx.database.db.transaction(
    (tx) => {
      tx.delete(deletionReceipts).where(eq(deletionReceipts.installationId, installation.id)).run();
      tx.insert(deletionReceipts)
        .values({
          id: receiptId,
          proofHash: ctx.hasher.verifier("deletion-proof", receiptProof),
          installationId: installation.id,
          status: "pending",
          createdAt: now,
          expiresAt,
        })
        .run();
    },
    { behavior: "immediate" },
  );
  return { receiptId, receiptProof, status: "pending", expiresAt: iso(expiresAt) };
}

/** Deletes live activity and revokes the credential in one transaction. */
export function deleteMe(ctx: AppContext, installation: Installation, receiptId: string): DeletionStatusResponse {
  const now = ctx.clock.now();
  return ctx.database.db.transaction(
    (tx) => {
      const receipt = tx.select().from(deletionReceipts).where(eq(deletionReceipts.id, receiptId)).get();
      if (
        !receipt ||
        receipt.installationId !== installation.id ||
        receipt.status !== "pending" ||
        receipt.expiresAt <= now
      ) {
        throw new AppError("DELETION_RECEIPT_INVALID");
      }
      deleteInstallation(tx, installation.id, now);
      return toStatus({ ...receipt, status: "completed", completedAt: now, installationId: null });
    },
    { behavior: "immediate" },
  );
}

/** Status lookup authenticated only by the receipt proof. Unknown and wrong-proof look the same. */
export function getDeletionStatus(
  ctx: AppContext,
  receiptId: string,
  proof: string | undefined,
): DeletionStatusResponse {
  const receipt = ctx.database.db.select().from(deletionReceipts).where(eq(deletionReceipts.id, receiptId)).get();
  const presented = ctx.hasher.verifier("deletion-proof", proof ?? "");
  const proofMatches = ctx.hasher.equal(receipt?.proofHash ?? "", presented);
  if (!receipt || !proofMatches) throw new AppError("NOT_FOUND");
  if (receipt.status === "pending" && receipt.expiresAt <= ctx.clock.now()) throw new AppError("NOT_FOUND");
  return toStatus(receipt);
}

// --- Maintenance ------------------------------------------------------------------------------

export interface MaintenanceReport {
  expiredInstallations: number;
  purgedOperations: number;
  purgedDeletionReceipts: number;
}

/** Local maintenance pass: inactivity expiry and bounded retention of auxiliary records. */
export function runMaintenance(ctx: AppContext): MaintenanceReport {
  const now = ctx.clock.now();
  return ctx.database.db.transaction(
    (tx) => {
      const expired = tx
        .select({ id: installations.id })
        .from(installations)
        .where(lt(installations.lastActiveAt, now - INACTIVITY_EXPIRY_MS))
        .all();
      for (const { id } of expired) deleteInstallation(tx, id, now);
      const purgedOperations = purgeOperationsBefore(tx, now - ctx.config.idempotencyRetentionMs);
      const stalePending = tx
        .delete(deletionReceipts)
        .where(and(eq(deletionReceipts.status, "pending"), lt(deletionReceipts.expiresAt, now)))
        .run().changes;
      const oldCompleted = tx
        .delete(deletionReceipts)
        .where(
          and(
            eq(deletionReceipts.status, "completed"),
            lt(deletionReceipts.completedAt, now - ctx.config.deletionReceiptRetentionMs),
          ),
        )
        .run().changes;
      return {
        expiredInstallations: expired.length,
        purgedOperations,
        purgedDeletionReceipts: stalePending + oldCompleted,
      };
    },
    { behavior: "immediate" },
  );
}
