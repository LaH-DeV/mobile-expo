import { z } from "zod";
import { OpaqueIdSchema, RevisionSchema, TimestampSchema } from "./common";

/** Opaque bearer credential: `sh1_` followed by 43 base64url characters (256 random bits). */
export const CREDENTIAL_PATTERN = /^sh1_[A-Za-z0-9_-]{43}$/;

export const ProvisionInstallationResponseSchema = z.object({
  installationId: OpaqueIdSchema,
  /**
   * Returned exactly once. Store it only in OS secure storage; never in logs, URLs or ordinary
   * snapshots. The server keeps only a verifier hash and cannot recover it.
   */
  credential: z.string().regex(CREDENTIAL_PATTERN),
  installationRevision: RevisionSchema,
  inactivityExpiresAt: TimestampSchema,
});
export type ProvisionInstallationResponse = z.infer<typeof ProvisionInstallationResponseSchema>;

export const MeResponseSchema = z.object({
  installationId: OpaqueIdSchema,
  installationRevision: RevisionSchema,
  activeRunId: OpaqueIdSchema.nullable(),
  createdAt: TimestampSchema,
  /** The installation and its runs expire if no authenticated use happens before this time. */
  inactivityExpiresAt: TimestampSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
