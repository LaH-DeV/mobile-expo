import { OperationTypeSchema, type OperationStatusResponse } from "@signal-hunt/contracts";
import type { AppContext } from "../../infrastructure/context";
import { findOperation } from "../../infrastructure/idempotency";

/**
 * Owned operation-status lookup. Keys are scoped to the installation, so another installation's
 * key is indistinguishable from an unused one. `unknown` only means nothing is committed under
 * this key right now; it does not prove that an in-flight request failed.
 */
export function getOperationStatus(ctx: AppContext, installationId: string, key: string): OperationStatusResponse {
  const record = findOperation(ctx.database.db, installationId, key);
  if (!record) return { status: "unknown" };
  return {
    status: "committed",
    operation: OperationTypeSchema.parse(record.operation),
    committedAt: new Date(record.committedAt).toISOString(),
    httpStatus: record.httpStatus,
    outcome: JSON.parse(record.outcome) as unknown,
  };
}
