import { z } from "zod";

/**
 * Stable, language-independent error vocabulary. `messageKey` is an English semantic key that the
 * client translates; the API never returns localized sentences. `retryable` means the same logical
 * action may succeed later (possibly after refreshing state or acquiring new input).
 */
export const ERRORS = {
  INVALID_REQUEST: { status: 400, messageKey: "request.errors.invalid", retryable: false },
  LOCALE_UNSUPPORTED: { status: 400, messageKey: "request.errors.localeUnsupported", retryable: false },
  IDEMPOTENCY_KEY_INVALID: { status: 400, messageKey: "request.errors.idempotencyKeyInvalid", retryable: false },
  INSECURE_TRANSPORT: { status: 400, messageKey: "request.errors.insecureTransport", retryable: false },
  ANSWER_INVALID: { status: 400, messageKey: "question.errors.answerInvalid", retryable: false },
  ANSWER_TYPE_MISMATCH: { status: 400, messageKey: "question.errors.answerTypeMismatch", retryable: false },
  CREDENTIAL_INVALID: { status: 401, messageKey: "identity.errors.credentialInvalid", retryable: false },
  INSTALLATION_EXPIRED: { status: 401, messageKey: "identity.errors.installationExpired", retryable: false },
  NOT_FOUND: { status: 404, messageKey: "request.errors.notFound", retryable: false },
  RUN_REVISION_CONFLICT: { status: 409, messageKey: "run.errors.revisionConflict", retryable: true },
  INSTALLATION_REVISION_CONFLICT: { status: 409, messageKey: "identity.errors.revisionConflict", retryable: true },
  IDEMPOTENCY_KEY_CONFLICT: { status: 409, messageKey: "request.errors.idempotencyKeyConflict", retryable: false },
  RUN_NOT_ACTIVE: { status: 409, messageKey: "run.errors.notActive", retryable: false },
  RUN_NOT_SUSPENDED: { status: 409, messageKey: "run.errors.notSuspended", retryable: false },
  RUN_TERMINAL: { status: 409, messageKey: "run.errors.terminal", retryable: false },
  SUSPENDED_RUN_LIMIT: { status: 409, messageKey: "run.errors.suspendedLimit", retryable: false },
  HUNT_VERSION_SUPERSEDED: { status: 409, messageKey: "hunt.errors.versionSuperseded", retryable: true },
  CHECKPOINT_NOT_REACHABLE: { status: 409, messageKey: "checkpoint.errors.notReachable", retryable: false },
  CHECKPOINT_ALREADY_UNLOCKED: { status: 409, messageKey: "checkpoint.errors.alreadyUnlocked", retryable: false },
  QUESTION_ALREADY_RESOLVED: { status: 409, messageKey: "question.errors.alreadyResolved", retryable: false },
  NO_HINTS_REMAINING: { status: 409, messageKey: "question.errors.noHintsRemaining", retryable: false },
  FINALE_NOT_QR: { status: 409, messageKey: "finale.errors.notQr", retryable: false },
  FINALE_NOT_UNLOCKED: { status: 409, messageKey: "finale.errors.notUnlocked", retryable: false },
  QR_ALREADY_VALIDATED: { status: 409, messageKey: "finale.errors.qrAlreadyValidated", retryable: false },
  DELETION_RECEIPT_INVALID: { status: 409, messageKey: "deletion.errors.receiptInvalid", retryable: true },
  HUNT_UNAVAILABLE: { status: 410, messageKey: "hunt.errors.unavailable", retryable: false },
  PAYLOAD_TOO_LARGE: { status: 413, messageKey: "request.errors.payloadTooLarge", retryable: false },
  LOCATION_TOO_FAR: { status: 422, messageKey: "checkpoint.location.tooFar", retryable: true },
  LOCATION_ACCURACY_INSUFFICIENT: { status: 422, messageKey: "checkpoint.location.inaccurate", retryable: true },
  LOCATION_FIX_STALE: { status: 422, messageKey: "checkpoint.location.stale", retryable: true },
  LOCATION_FIX_IN_FUTURE: { status: 422, messageKey: "checkpoint.location.clockSkew", retryable: true },
  QR_FORMAT_INVALID: { status: 422, messageKey: "finale.qr.formatInvalid", retryable: true },
  QR_WRONG_CACHE: { status: 422, messageKey: "finale.qr.wrongCache", retryable: true },
  RATE_LIMITED: { status: 429, messageKey: "request.errors.rateLimited", retryable: true },
  INTERNAL_ERROR: { status: 500, messageKey: "request.errors.internal", retryable: true },
  SERVICE_UNAVAILABLE: { status: 503, messageKey: "request.errors.serviceUnavailable", retryable: true },
} as const satisfies Record<string, { status: number; messageKey: string; retryable: boolean }>;

export type ErrorCode = keyof typeof ERRORS;
export const ERROR_CODES = Object.keys(ERRORS) as [ErrorCode, ...ErrorCode[]];
export const ErrorCodeSchema = z.enum(ERROR_CODES);

const SafeParamValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type SafeParamValue = z.infer<typeof SafeParamValueSchema>;
export type SafeParams = Record<string, SafeParamValue | SafeParamValue[]>;

/**
 * Error envelope returned for every non-2xx response. `params` holds only safe interpolation
 * values (thresholds, field paths, retry delays) and never echoes submitted input.
 */
export const ErrorEnvelopeSchema = z.object({
  code: ErrorCodeSchema,
  messageKey: z.string(),
  params: z.record(z.string(), z.union([SafeParamValueSchema, z.array(SafeParamValueSchema)])),
  retryable: z.boolean(),
  correlationId: z.string(),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
