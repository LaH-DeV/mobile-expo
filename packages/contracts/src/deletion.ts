import { z } from "zod";
import { OpaqueIdSchema, TimestampSchema } from "./common";

export const DELETION_PROOF_PATTERN = /^shd1_[A-Za-z0-9_-]{43}$/;

export const DeletionStatusSchema = z.enum(["pending", "completed"]);
export type DeletionStatus = z.infer<typeof DeletionStatusSchema>;

/**
 * Restricted deletion capability. `receiptProof` is returned once, must be stored like a secret
 * and is sent only in the `X-Deletion-Receipt-Proof` header. It can confirm deletion status after
 * the credential is revoked; it can never read runs, restore identity or mutate gameplay.
 */
export const DeletionReceiptResponseSchema = z.object({
  receiptId: OpaqueIdSchema,
  receiptProof: z.string().regex(DELETION_PROOF_PATTERN),
  status: DeletionStatusSchema,
  /** A pending receipt that is not used before this time stops being valid. */
  expiresAt: TimestampSchema,
});
export type DeletionReceiptResponse = z.infer<typeof DeletionReceiptResponseSchema>;

export const DeletionStatusResponseSchema = z.object({
  receiptId: OpaqueIdSchema,
  status: DeletionStatusSchema,
  requestedAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
});
export type DeletionStatusResponse = z.infer<typeof DeletionStatusResponseSchema>;

export const DeletionParamsSchema = z.strictObject({ receiptId: OpaqueIdSchema });
