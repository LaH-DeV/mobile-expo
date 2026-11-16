import type { OperationType } from "@signal-hunt/contracts";
import { and, eq, lt } from "drizzle-orm";
import type { AppContext } from "./context";
import type { Db } from "./db/client";
import { operations } from "./db/schema";
import { AppError } from "./errors";

export interface OperationOutcome {
  httpStatus: number;
  /** Safe public response body. This is what gets persisted and replayed. */
  body: unknown;
  runId: string | null;
}

export interface OperationRequest {
  installationId: string;
  key: string;
  operation: OperationType;
  /** Everything that defines the request (route params, body, locale). Stored only as an HMAC. */
  fingerprintInput: unknown;
  /** Applies the mutation inside the transaction. Throwing rolls everything back. */
  apply(tx: Db): OperationOutcome;
}

export interface OperationResult {
  replayed: boolean;
  httpStatus: number;
  body: unknown;
}

/**
 * Runs a mutation exactly once per (installation, idempotency key).
 *
 * The duplicate check, the mutation and the outcome record share one IMMEDIATE transaction, and
 * the primary key on (installation_id, key) is the final guard, so concurrent duplicates cannot
 * both apply. A replay is answered before any transient input (fix age, QR) is re-evaluated.
 * Only successful outcomes are recorded: a rejected request changed nothing and may be retried
 * with the same key once its cause is fixed.
 */
export function executeOperation(ctx: AppContext, request: OperationRequest): OperationResult {
  const fingerprint = ctx.hasher.fingerprint({ operation: request.operation, input: request.fingerprintInput });
  return ctx.database.db.transaction(
    (tx) => {
      const existing = tx
        .select()
        .from(operations)
        .where(and(eq(operations.installationId, request.installationId), eq(operations.key, request.key)))
        .get();
      if (existing) {
        if (!ctx.hasher.equal(existing.fingerprint, fingerprint)) throw new AppError("IDEMPOTENCY_KEY_CONFLICT");
        return { replayed: true, httpStatus: existing.httpStatus, body: JSON.parse(existing.outcome) as unknown };
      }
      const outcome = request.apply(tx);
      tx.insert(operations)
        .values({
          installationId: request.installationId,
          key: request.key,
          operation: request.operation,
          fingerprint,
          runId: outcome.runId,
          httpStatus: outcome.httpStatus,
          outcome: JSON.stringify(outcome.body),
          committedAt: ctx.clock.now(),
        })
        .run();
      return { replayed: false, httpStatus: outcome.httpStatus, body: outcome.body };
    },
    { behavior: "immediate" },
  );
}

export function findOperation(db: Db, installationId: string, key: string) {
  return db
    .select()
    .from(operations)
    .where(and(eq(operations.installationId, installationId), eq(operations.key, key)))
    .get();
}

export function purgeOperationsBefore(db: Db, cutoff: number): number {
  return db.delete(operations).where(lt(operations.committedAt, cutoff)).run().changes;
}
