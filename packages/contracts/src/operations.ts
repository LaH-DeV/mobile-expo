import { z } from "zod";
import { IdempotencyKeySchema, TimestampSchema } from "./common";
import {
  AnswerQuestionResponseSchema,
  RevealAnswerResponseSchema,
  RevealHintResponseSchema,
  RunMutationResponseSchema,
} from "./runs";

export const OPERATION_TYPES = [
  "run.start",
  "run.resume",
  "run.suspend",
  "run.abandon",
  "checkpoint.unlock",
  "question.answer",
  "question.hint",
  "question.reveal",
  "finale.scan",
] as const;
export const OperationTypeSchema = z.enum(OPERATION_TYPES);
export type OperationType = z.infer<typeof OperationTypeSchema>;

/** Response schema of the committed outcome for each operation type. */
export const OPERATION_OUTCOME_SCHEMAS = {
  "run.start": RunMutationResponseSchema,
  "run.resume": RunMutationResponseSchema,
  "run.suspend": RunMutationResponseSchema,
  "run.abandon": RunMutationResponseSchema,
  "checkpoint.unlock": RunMutationResponseSchema,
  "question.answer": AnswerQuestionResponseSchema,
  "question.hint": RevealHintResponseSchema,
  "question.reveal": RevealAnswerResponseSchema,
  "finale.scan": RunMutationResponseSchema,
} as const satisfies Record<OperationType, z.ZodType>;

export const OperationParamsSchema = z.strictObject({ operationKey: IdempotencyKeySchema });

/**
 * `committed`: the operation was applied; `outcome` is the exact body originally returned (in the
 * locale of the original request) and validates against `OPERATION_OUTCOME_SCHEMAS[operation]`.
 *
 * `unknown`: no committed operation is recorded under this key for this installation. This is
 * NOT proof that an in-flight request failed. Refresh run and lifecycle state before retrying.
 */
export const OperationStatusResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("committed"),
    operation: OperationTypeSchema,
    committedAt: TimestampSchema,
    httpStatus: z.number().int(),
    outcome: z.unknown(),
  }),
  z.object({ status: z.literal("unknown") }),
]);
export type OperationStatusResponse = z.infer<typeof OperationStatusResponseSchema>;
