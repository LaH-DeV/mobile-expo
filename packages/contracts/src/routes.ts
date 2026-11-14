import type { z } from "zod";
import { HuntDetailSchema, HuntParamsSchema, ListHuntsQuerySchema, ListHuntsResponseSchema } from "./catalog";
import { DeletionParamsSchema, DeletionReceiptResponseSchema, DeletionStatusResponseSchema } from "./deletion";
import { HealthResponseSchema, ReadyResponseSchema } from "./health";
import { MeResponseSchema, ProvisionInstallationResponseSchema } from "./installations";
import { OperationParamsSchema, OperationStatusResponseSchema, type OperationType } from "./operations";
import {
  AbandonRunRequestSchema,
  AnswerQuestionRequestSchema,
  AnswerQuestionResponseSchema,
  CheckpointParamsSchema,
  ListRunsQuerySchema,
  ListRunsResponseSchema,
  QuestionParamsSchema,
  ResumeRunRequestSchema,
  RevealAnswerRequestSchema,
  RevealAnswerResponseSchema,
  RevealHintRequestSchema,
  RevealHintResponseSchema,
  RunMutationResponseSchema,
  RunParamsSchema,
  RunSnapshotSchema,
  ScanFinaleRequestSchema,
  StartRunRequestSchema,
  SuspendRunRequestSchema,
  UnlockCheckpointRequestSchema,
} from "./runs";

export type RouteAuth = "none" | "bearer" | "deletion-proof";

export interface RouteContract {
  method: "GET" | "POST" | "DELETE";
  /** Fastify-style path with `:param` placeholders. */
  path: string;
  summary: string;
  /** `bearer`: `Authorization: Bearer <credential>`; `deletion-proof`: `X-Deletion-Receipt-Proof`. */
  auth: RouteAuth;
  /** Requires `Accept-Language: pl|en`; the response is localized and varies by it. */
  localized: boolean;
  /** Mutation recorded under the required `Idempotency-Key` header with this operation type. */
  operation?: OperationType;
  /** Additional required request headers (lower-case). */
  headers?: readonly string[];
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  successStatus: 200 | 201;
  response: z.ZodType;
}

/**
 * The complete public API surface. The server registers its routes from this table and derives
 * the OpenAPI description from it; a client can use it to build a typed `HuntApi` adapter.
 */
export const ROUTES = {
  health: {
    method: "GET",
    path: "/health",
    summary: "Process liveness",
    auth: "none",
    localized: false,
    successStatus: 200,
    response: HealthResponseSchema,
  },
  ready: {
    method: "GET",
    path: "/ready",
    summary: "Database, schema and content readiness (503 with the same body when not ready)",
    auth: "none",
    localized: false,
    successStatus: 200,
    response: ReadyResponseSchema,
  },
  listHunts: {
    method: "GET",
    path: "/v1/hunts",
    summary: "Safe catalog of available hunts",
    auth: "none",
    localized: true,
    query: ListHuntsQuerySchema,
    successStatus: 200,
    response: ListHuntsResponseSchema,
  },
  getHunt: {
    method: "GET",
    path: "/v1/hunts/:huntId",
    summary: "Safe hunt details, public start point and current availability",
    auth: "none",
    localized: true,
    params: HuntParamsSchema,
    successStatus: 200,
    response: HuntDetailSchema,
  },
  provisionInstallation: {
    method: "POST",
    path: "/v1/installations",
    summary: "Issue an anonymous installation credential (returned once)",
    auth: "none",
    localized: false,
    successStatus: 201,
    response: ProvisionInstallationResponseSchema,
  },
  getMe: {
    method: "GET",
    path: "/v1/me",
    summary: "Installation lifecycle revision and safe identity status",
    auth: "bearer",
    localized: false,
    successStatus: 200,
    response: MeResponseSchema,
  },
  getOperation: {
    method: "GET",
    path: "/v1/operations/:operationKey",
    summary: "Owned committed outcome for an idempotency key, or `unknown`",
    auth: "bearer",
    localized: false,
    params: OperationParamsSchema,
    successStatus: 200,
    response: OperationStatusResponseSchema,
  },
  listRuns: {
    method: "GET",
    path: "/v1/runs",
    summary: "Owned run summaries (journal)",
    auth: "bearer",
    localized: true,
    query: ListRunsQuerySchema,
    successStatus: 200,
    response: ListRunsResponseSchema,
  },
  startRun: {
    method: "POST",
    path: "/v1/runs",
    summary: "Start or replay the current hunt version; suspends the previous active run atomically",
    auth: "bearer",
    localized: true,
    operation: "run.start",
    body: StartRunRequestSchema,
    successStatus: 201,
    response: RunMutationResponseSchema,
  },
  getRun: {
    method: "GET",
    path: "/v1/runs/:runId",
    summary: "Owned safe run snapshot",
    auth: "bearer",
    localized: true,
    params: RunParamsSchema,
    successStatus: 200,
    response: RunSnapshotSchema,
  },
  resumeRun: {
    method: "POST",
    path: "/v1/runs/:runId/resume",
    summary: "Resume a suspended run; suspends the other active run atomically",
    auth: "bearer",
    localized: true,
    operation: "run.resume",
    params: RunParamsSchema,
    body: ResumeRunRequestSchema,
    successStatus: 200,
    response: RunMutationResponseSchema,
  },
  suspendRun: {
    method: "POST",
    path: "/v1/runs/:runId/suspend",
    summary: "Suspend the active run, preserving its state",
    auth: "bearer",
    localized: true,
    operation: "run.suspend",
    params: RunParamsSchema,
    body: SuspendRunRequestSchema,
    successStatus: 200,
    response: RunMutationResponseSchema,
  },
  abandonRun: {
    method: "POST",
    path: "/v1/runs/:runId/abandon",
    summary: "Confirmed terminal abandonment",
    auth: "bearer",
    localized: true,
    operation: "run.abandon",
    params: RunParamsSchema,
    body: AbandonRunRequestSchema,
    successStatus: 200,
    response: RunMutationResponseSchema,
  },
  unlockCheckpoint: {
    method: "POST",
    path: "/v1/runs/:runId/checkpoints/:checkpointId/unlock",
    summary: "Unlock the current checkpoint with a fresh fix; draws and persists its questions",
    auth: "bearer",
    localized: true,
    operation: "checkpoint.unlock",
    params: CheckpointParamsSchema,
    body: UnlockCheckpointRequestSchema,
    successStatus: 200,
    response: RunMutationResponseSchema,
  },
  answerQuestion: {
    method: "POST",
    path: "/v1/runs/:runId/questions/:selectedId/answer",
    summary: "Submit an answer for server-side evaluation",
    auth: "bearer",
    localized: true,
    operation: "question.answer",
    params: QuestionParamsSchema,
    body: AnswerQuestionRequestSchema,
    successStatus: 200,
    response: AnswerQuestionResponseSchema,
  },
  revealHint: {
    method: "POST",
    path: "/v1/runs/:runId/questions/:selectedId/hint",
    summary: "Reveal the next authored hint",
    auth: "bearer",
    localized: true,
    operation: "question.hint",
    params: QuestionParamsSchema,
    body: RevealHintRequestSchema,
    successStatus: 200,
    response: RevealHintResponseSchema,
  },
  revealAnswer: {
    method: "POST",
    path: "/v1/runs/:runId/questions/:selectedId/reveal",
    summary: "Confirmed answer assistance; resolves the question as assisted",
    auth: "bearer",
    localized: true,
    operation: "question.reveal",
    params: QuestionParamsSchema,
    body: RevealAnswerRequestSchema,
    successStatus: 200,
    response: RevealAnswerResponseSchema,
  },
  scanFinale: {
    method: "POST",
    path: "/v1/runs/:runId/finale/scan",
    summary: "Validate a scanned QR payload with a fresh fix at the final checkpoint",
    auth: "bearer",
    localized: true,
    operation: "finale.scan",
    params: RunParamsSchema,
    body: ScanFinaleRequestSchema,
    successStatus: 200,
    response: RunMutationResponseSchema,
  },
  createDeletionReceipt: {
    method: "POST",
    path: "/v1/me/deletion-receipt",
    summary: "Issue (or re-issue) the restricted deletion receipt while authenticated",
    auth: "bearer",
    localized: false,
    successStatus: 201,
    response: DeletionReceiptResponseSchema,
  },
  deleteMe: {
    method: "DELETE",
    path: "/v1/me",
    summary: "Delete all live activity and revoke the credential",
    auth: "bearer",
    localized: false,
    headers: ["x-deletion-receipt-id"],
    successStatus: 200,
    response: DeletionStatusResponseSchema,
  },
  getDeletion: {
    method: "GET",
    path: "/v1/deletions/:receiptId",
    summary: "Deletion status, authenticated only by the receipt proof header",
    auth: "deletion-proof",
    localized: false,
    params: DeletionParamsSchema,
    successStatus: 200,
    response: DeletionStatusResponseSchema,
  },
} as const satisfies Record<string, RouteContract>;

export type RouteName = keyof typeof ROUTES;
