import { ERRORS, type ErrorCode, type ErrorEnvelope, type SafeParams } from "@signal-hunt/contracts";

/**
 * An expected failure with a stable public code. `params` must contain only safe values
 * (thresholds, field paths); never submitted input, answers, tokens or coordinates.
 */
export class AppError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: ErrorCode,
    readonly params: SafeParams = {},
  ) {
    super(code);
    this.name = "AppError";
    this.statusCode = ERRORS[code].status;
  }
}

export function toEnvelope(error: AppError, correlationId: string): ErrorEnvelope {
  const definition = ERRORS[error.code];
  return {
    code: error.code,
    messageKey: definition.messageKey,
    params: error.params,
    retryable: definition.retryable,
    correlationId,
  };
}
