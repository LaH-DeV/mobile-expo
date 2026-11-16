import { z } from "zod";
import { LIMITS } from "./limits";

/** Server-issued opaque identifiers (runs, selected questions, installations, receipts). */
export const OpaqueIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Author-assigned stable content identifiers (hunts, checkpoints, questions, choices, media). */
export const ContentIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);

export const HuntVersionSchema = z.number().int().min(1).max(1_000_000);
export const RevisionSchema = z.number().int().min(0);
export const TimestampSchema = z.iso.datetime();

/** Client-generated random key sent in the `Idempotency-Key` header (a UUID fits). */
export const IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/** Lower-case header names used by the API in addition to `Authorization` and `Accept-Language`. */
export const HEADERS = {
  idempotencyKey: "idempotency-key",
  idempotencyReplayed: "idempotency-replayed",
  correlationId: "x-correlation-id",
  deletionReceiptId: "x-deletion-receipt-id",
  deletionReceiptProof: "x-deletion-receipt-proof",
} as const;

export const CoordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type Coordinates = z.infer<typeof CoordinatesSchema>;

/**
 * A device location fix submitted for one proximity-gated action. The server validates it
 * transiently and never stores or logs it. Unknown fields (for example a client-computed
 * distance) are rejected.
 */
export const LocationFixSchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** Reported horizontal accuracy radius in metres; must be finite and non-negative. */
  accuracyMeters: z.number().min(0).max(100_000),
  /** When the device captured the fix (ISO 8601 with offset or `Z`). */
  capturedAt: z.iso.datetime({ offset: true }),
});
export type LocationFix = z.infer<typeof LocationFixSchema>;

export const PageQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(LIMITS.pageSizeDefault),
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
});

export const AvailabilityReasonSchema = z.enum(["withdrawn", "maintenance", "safety"]);
export type AvailabilityReason = z.infer<typeof AvailabilityReasonSchema>;

export const AvailabilitySchema = z.object({
  available: z.boolean(),
  /** Language-independent reason code when unavailable; the client translates it. */
  reasonCode: AvailabilityReasonSchema.nullable(),
});
export type Availability = z.infer<typeof AvailabilitySchema>;

export const MediaRefSchema = z.object({
  mediaId: ContentIdSchema,
  altText: z.string(),
});
export type MediaRef = z.infer<typeof MediaRefSchema>;

export const FinaleTypeSchema = z.enum(["digital", "qr"]);
export type FinaleType = z.infer<typeof FinaleTypeSchema>;
