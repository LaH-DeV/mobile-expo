import { z } from "zod";
import {
  AvailabilitySchema,
  ContentIdSchema,
  CoordinatesSchema,
  FinaleTypeSchema,
  HuntVersionSchema,
  LocationFixSchema,
  MediaRefSchema,
  OpaqueIdSchema,
  PageQuerySchema,
  RevisionSchema,
  TimestampSchema,
} from "./common";
import { LIMITS } from "./limits";

export const RunStateSchema = z.enum(["active", "suspended", "completed", "abandoned"]);
export type RunState = z.infer<typeof RunStateSchema>;

export const CheckpointStateSchema = z.enum(["reachable", "unlocked", "resolved"]);
export type CheckpointState = z.infer<typeof CheckpointStateSchema>;

export const QuestionTypeSchema = z.enum(["text", "numeric", "choice"]);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const QuestionResolutionSchema = z.enum(["unresolved", "correct", "assisted"]);
export type QuestionResolution = z.infer<typeof QuestionResolutionSchema>;

/** Authored answer display and explanation, returned only after confirmed assistance. */
export const AssistanceSchema = z.object({
  answerDisplay: z.string(),
  explanation: z.string(),
});
export type Assistance = z.infer<typeof AssistanceSchema>;

/**
 * One question drawn for this run. Contains no correctness flags, accepted answers, tolerance,
 * undisclosed hints or other pool members.
 */
export const SelectedQuestionSchema = z.object({
  /** Opaque per-run identifier used in answer/hint/reveal routes. */
  selectedId: OpaqueIdSchema,
  type: QuestionTypeSchema,
  prompt: z.string(),
  image: MediaRefSchema.nullable(),
  /** Present only for `choice` questions, in the order persisted at unlock. */
  choices: z.array(z.object({ id: ContentIdSchema, text: z.string() })).nullable(),
  resolution: QuestionResolutionSchema,
  resolvedAt: TimestampSchema.nullable(),
  /** Hints already revealed for this run, in authored order. */
  revealedHints: z.array(z.string()),
  hasMoreHints: z.boolean(),
  /** Present only when `resolution` is `assisted`. */
  assistance: AssistanceSchema.nullable(),
});
export type SelectedQuestion = z.infer<typeof SelectedQuestionSchema>;

/** A checkpoint the run is authorized to see: already reached ones and the current target. */
export const RevealedCheckpointSchema = z.object({
  id: ContentIdSchema,
  /** 1-based position in the trail. */
  order: z.number().int().min(1),
  title: z.string(),
  state: CheckpointStateSchema,
  location: CoordinatesSchema,
  radiusMeters: z.number().int(),
  isFinale: z.boolean(),
  unlockedAt: TimestampSchema.nullable(),
  resolvedAt: TimestampSchema.nullable(),
  /** Empty until the checkpoint is unlocked by a valid proximity check. */
  questions: z.array(SelectedQuestionSchema),
});
export type RevealedCheckpoint = z.infer<typeof RevealedCheckpointSchema>;

/** Independent finale conditions. For `digital` hunts `qrRequired` is false. */
export const FinaleStatusSchema = z.object({
  type: FinaleTypeSchema,
  unlocked: z.boolean(),
  questionsResolved: z.boolean(),
  qrRequired: z.boolean(),
  qrValidated: z.boolean(),
  qrValidatedAt: TimestampSchema.nullable(),
});
export type FinaleStatus = z.infer<typeof FinaleStatusSchema>;

const RunCommonShape = {
  id: OpaqueIdSchema,
  state: RunStateSchema,
  revision: RevisionSchema,
  huntId: ContentIdSchema,
  /** Immutable content version this run is pinned to. */
  huntVersion: HuntVersionSchema,
  huntTitle: z.string(),
  finaleType: FinaleTypeSchema,
  availability: AvailabilitySchema,
  checkpointCount: z.number().int().min(1),
  resolvedCheckpointCount: z.number().int().min(0),
  hintsUsed: z.number().int().min(0),
  assistedQuestionCount: z.number().int().min(0),
  startedAt: TimestampSchema,
  updatedAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
  abandonedAt: TimestampSchema.nullable(),
};

export const RunSummarySchema = z.object(RunCommonShape);
export type RunSummary = z.infer<typeof RunSummarySchema>;

/** Authoritative, safe view of one owned run in the request locale. */
export const RunSnapshotSchema = z.object({
  ...RunCommonShape,
  /** Ordered; never contains checkpoints beyond the current target. */
  checkpoints: z.array(RevealedCheckpointSchema),
  finale: FinaleStatusSchema,
});
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;

export const AffectedRunSchema = z.object({
  id: OpaqueIdSchema,
  state: RunStateSchema,
  revision: RevisionSchema,
});
export type AffectedRun = z.infer<typeof AffectedRunSchema>;

const MutationShape = {
  /** Installation lifecycle revision after this operation. */
  installationRevision: RevisionSchema,
  run: RunSnapshotSchema,
  /** Other runs changed by the same transaction (for example a run suspended by a switch). */
  affectedRuns: z.array(AffectedRunSchema),
};

export const RunMutationResponseSchema = z.object(MutationShape);
export type RunMutationResponse = z.infer<typeof RunMutationResponseSchema>;

// --- Requests -------------------------------------------------------------------------------

export const RunParamsSchema = z.strictObject({ runId: OpaqueIdSchema });
export const CheckpointParamsSchema = z.strictObject({ runId: OpaqueIdSchema, checkpointId: ContentIdSchema });
export const QuestionParamsSchema = z.strictObject({ runId: OpaqueIdSchema, selectedId: OpaqueIdSchema });

export const ListRunsQuerySchema = PageQuerySchema.extend({
  /** `open` = active and suspended; `history` = completed and abandoned. Omit for all. */
  group: z.enum(["open", "history"]).optional(),
});
export type ListRunsQuery = z.infer<typeof ListRunsQuerySchema>;

export const ListRunsResponseSchema = z.object({
  installationRevision: RevisionSchema,
  items: z.array(RunSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListRunsResponse = z.infer<typeof ListRunsResponseSchema>;

/** Start or replay. The server chooses the run ID and the locale comes from `Accept-Language`. */
export const StartRunRequestSchema = z.strictObject({
  huntId: ContentIdSchema,
  huntVersion: HuntVersionSchema,
  expectedInstallationRevision: RevisionSchema,
});
export type StartRunRequest = z.infer<typeof StartRunRequestSchema>;

export const ResumeRunRequestSchema = z.strictObject({
  expectedRunRevision: RevisionSchema,
  expectedInstallationRevision: RevisionSchema,
});
export type ResumeRunRequest = z.infer<typeof ResumeRunRequestSchema>;

export const SuspendRunRequestSchema = z.strictObject({ expectedRunRevision: RevisionSchema });
export type SuspendRunRequest = z.infer<typeof SuspendRunRequestSchema>;

export const AbandonRunRequestSchema = z.strictObject({
  expectedRunRevision: RevisionSchema,
  /** Abandonment is terminal; the client must send an explicit confirmation. */
  confirm: z.literal(true),
});
export type AbandonRunRequest = z.infer<typeof AbandonRunRequestSchema>;

export const UnlockCheckpointRequestSchema = z.strictObject({
  expectedRunRevision: RevisionSchema,
  location: LocationFixSchema,
});
export type UnlockCheckpointRequest = z.infer<typeof UnlockCheckpointRequestSchema>;

export const AnswerInputSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), value: z.string().max(LIMITS.answerTextCodePoints * 4) }),
  z.strictObject({ type: z.literal("numeric"), value: z.string().max(LIMITS.numericAnswerChars + 16) }),
  z.strictObject({ type: z.literal("choice"), choiceId: ContentIdSchema }),
]);
export type AnswerInput = z.infer<typeof AnswerInputSchema>;

export const AnswerQuestionRequestSchema = z.strictObject({
  expectedRunRevision: RevisionSchema,
  answer: AnswerInputSchema,
});
export type AnswerQuestionRequest = z.infer<typeof AnswerQuestionRequestSchema>;

/** A wrong answer is a normal evaluation result (HTTP 200), not an error. */
export const AnswerQuestionResponseSchema = z.object({
  ...MutationShape,
  evaluation: z.object({ result: z.enum(["correct", "incorrect"]) }),
});
export type AnswerQuestionResponse = z.infer<typeof AnswerQuestionResponseSchema>;

export const RevealHintRequestSchema = z.strictObject({ expectedRunRevision: RevisionSchema });
export type RevealHintRequest = z.infer<typeof RevealHintRequestSchema>;

export const RevealHintResponseSchema = z.object({
  ...MutationShape,
  hint: z.object({ position: z.number().int().min(1), text: z.string() }),
});
export type RevealHintResponse = z.infer<typeof RevealHintResponseSchema>;

export const RevealAnswerRequestSchema = z.strictObject({
  expectedRunRevision: RevisionSchema,
  /** Assistance resolves the question as assisted; the client must send an explicit confirmation. */
  confirm: z.literal(true),
});
export type RevealAnswerRequest = z.infer<typeof RevealAnswerRequestSchema>;

export const RevealAnswerResponseSchema = z.object({
  ...MutationShape,
  assistance: AssistanceSchema,
});
export type RevealAnswerResponse = z.infer<typeof RevealAnswerResponseSchema>;

export const ScanFinaleRequestSchema = z.strictObject({
  expectedRunRevision: RevisionSchema,
  /** Raw scanned text. Anything not matching the QR grammar is rejected and never opened. */
  payload: z.string().min(1).max(LIMITS.qrPayloadChars),
  location: LocationFixSchema,
});
export type ScanFinaleRequest = z.infer<typeof ScanFinaleRequestSchema>;
