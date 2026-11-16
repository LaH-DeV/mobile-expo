import {
  LIMITS,
  type AbandonRunRequest,
  type AffectedRun,
  type ListRunsQuery,
  type ListRunsResponse,
  type Locale,
  type ResumeRunRequest,
  type RunMutationResponse,
  type RunSnapshot,
  type RunState,
  type StartRunRequest,
  type SuspendRunRequest,
} from "@signal-hunt/contracts";
import type { AppContext } from "../../infrastructure/context";
import type { Db } from "../../infrastructure/db/client";
import { AppError } from "../../infrastructure/errors";
import type { HuntDocument, HuntRecord } from "../content/store";
import { bumpLifecycleRevision, getLifecycleRevision } from "../installations/service";
import { decideProgress, transitionError, type RunAction } from "./domain";
import {
  countRunsInState,
  countUnresolved,
  findActiveRun,
  findOwnedRun,
  hasQrValidation,
  insertRun,
  listOwnedRuns,
  markCheckpointResolved,
  updateRun,
  type RunRow,
} from "./repository";
import { buildRunSnapshot, buildRunSummary } from "./snapshot";

/** Everything a mutation use case receives from the HTTP adapter. */
export interface MutationInput {
  installationId: string;
  locale: Locale;
  /** Server receipt time of the request. */
  now: number;
}

export function decodeOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const offset = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!Number.isSafeInteger(offset) || offset < 0) throw new AppError("INVALID_REQUEST", { fields: ["cursor"] });
  return offset;
}

export function encodeOffset(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

// --- Reads ------------------------------------------------------------------------------------

export function getRun(ctx: AppContext, installationId: string, runId: string, locale: Locale): RunSnapshot {
  const db = ctx.database.db;
  const run = findOwnedRun(db, installationId, runId);
  if (!run) throw new AppError("NOT_FOUND");
  return buildRunSnapshot(ctx, db, run, locale);
}

export function listRuns(
  ctx: AppContext,
  installationId: string,
  query: ListRunsQuery,
  locale: Locale,
): ListRunsResponse {
  const db = ctx.database.db;
  const states: RunState[] | null =
    query.group === "open" ? ["active", "suspended"] : query.group === "history" ? ["completed", "abandoned"] : null;
  const offset = decodeOffset(query.cursor);
  const rows = listOwnedRuns(db, installationId, states, query.limit + 1, offset);
  const page = rows.slice(0, query.limit);
  return {
    installationRevision: getLifecycleRevision(db, installationId),
    items: page.map((run) => buildRunSummary(ctx, db, run, locale)),
    nextCursor: rows.length > query.limit ? encodeOffset(offset + query.limit) : null,
  };
}

// --- Shared guards ----------------------------------------------------------------------------

function requireAvailable(hunt: HuntRecord | undefined): HuntRecord {
  if (!hunt) throw new AppError("NOT_FOUND");
  if (!hunt.availability.available) {
    throw new AppError("HUNT_UNAVAILABLE", { reasonCode: hunt.availability.reasonCode });
  }
  return hunt;
}

/**
 * Loads an owned run and checks, in order: ownership (non-enumerating 404), allowed state,
 * expected revision. Terminal runs are rejected before anything else can touch them.
 */
export function loadRunFor(
  db: Db,
  installationId: string,
  runId: string,
  action: RunAction,
  expectedRunRevision: number,
): RunRow {
  const run = findOwnedRun(db, installationId, runId);
  if (!run) throw new AppError("NOT_FOUND");
  const stateError = transitionError(run.state, action);
  if (stateError) throw new AppError(stateError);
  if (run.revision !== expectedRunRevision) throw new AppError("RUN_REVISION_CONFLICT");
  return run;
}

/** Guard shared by every gameplay mutation: owned, active, current revision, hunt available. */
export function loadRunForGameplay(
  ctx: AppContext,
  db: Db,
  installationId: string,
  runId: string,
  expectedRunRevision: number,
): { run: RunRow; document: HuntDocument } {
  const run = loadRunFor(db, installationId, runId, "gameplay", expectedRunRevision);
  requireAvailable(ctx.content.findHunt(db, run.huntId));
  return { run, document: ctx.content.getDocument(db, run.huntId, run.huntVersion) };
}

function affected(run: RunRow): AffectedRun {
  return { id: run.id, state: run.state, revision: run.revision };
}

export function mutationResponse(
  ctx: AppContext,
  db: Db,
  input: MutationInput,
  run: RunRow,
  affectedRuns: AffectedRun[] = [],
): RunMutationResponse {
  return {
    installationRevision: getLifecycleRevision(db, input.installationId),
    run: buildRunSnapshot(ctx, db, run, input.locale),
    affectedRuns,
  };
}

/** Suspends the installation's active run, if any, so another run can become active. */
function suspendActiveRun(db: Db, installationId: string, now: number, enforceLimit: boolean): AffectedRun[] {
  const active = findActiveRun(db, installationId);
  if (!active) return [];
  if (enforceLimit && countRunsInState(db, installationId, "suspended") >= LIMITS.suspendedRunsPerInstallation) {
    throw new AppError("SUSPENDED_RUN_LIMIT", { limit: LIMITS.suspendedRunsPerInstallation });
  }
  return [affected(updateRun(db, active, now, { state: "suspended" }))];
}

function requireInstallationRevision(db: Db, installationId: string, expected: number): void {
  if (getLifecycleRevision(db, installationId) !== expected) throw new AppError("INSTALLATION_REVISION_CONFLICT");
}

// --- Lifecycle mutations (each runs inside the caller's transaction) ---------------------------

export function startRun(ctx: AppContext, tx: Db, input: MutationInput, request: StartRunRequest): RunMutationResponse {
  requireInstallationRevision(tx, input.installationId, request.expectedInstallationRevision);
  const hunt = requireAvailable(ctx.content.findHunt(tx, request.huntId));
  if (request.huntVersion !== hunt.currentVersion) {
    if (!ctx.content.findDocument(tx, request.huntId, request.huntVersion)) throw new AppError("NOT_FOUND");
    throw new AppError("HUNT_VERSION_SUPERSEDED", { currentVersion: hunt.currentVersion });
  }
  const affectedRuns = suspendActiveRun(tx, input.installationId, input.now, true);
  const run = insertRun(tx, {
    id: `run_${ctx.random.token(16)}`,
    installationId: input.installationId,
    huntId: hunt.id,
    huntVersion: hunt.currentVersion,
    state: "active",
    revision: 1,
    currentCheckpointIndex: 0,
    startedAt: input.now,
    updatedAt: input.now,
  });
  bumpLifecycleRevision(tx, input.installationId);
  return mutationResponse(ctx, tx, input, run, affectedRuns);
}

export function resumeRun(
  ctx: AppContext,
  tx: Db,
  input: MutationInput,
  runId: string,
  request: ResumeRunRequest,
): RunMutationResponse {
  const run = loadRunFor(tx, input.installationId, runId, "resume", request.expectedRunRevision);
  requireInstallationRevision(tx, input.installationId, request.expectedInstallationRevision);
  requireAvailable(ctx.content.findHunt(tx, run.huntId));
  // The resumed run leaves the suspended set as the other enters it, so the limit cannot grow.
  const affectedRuns = suspendActiveRun(tx, input.installationId, input.now, false);
  const resumed = updateRun(tx, run, input.now, { state: "active" });
  bumpLifecycleRevision(tx, input.installationId);
  return mutationResponse(ctx, tx, input, resumed, affectedRuns);
}

/** Allowed for unavailable hunts: availability gates progression, not lifecycle housekeeping. */
export function suspendRun(
  ctx: AppContext,
  tx: Db,
  input: MutationInput,
  runId: string,
  request: SuspendRunRequest,
): RunMutationResponse {
  const run = loadRunFor(tx, input.installationId, runId, "suspend", request.expectedRunRevision);
  const suspended = updateRun(tx, run, input.now, { state: "suspended" });
  bumpLifecycleRevision(tx, input.installationId);
  return mutationResponse(ctx, tx, input, suspended);
}

export function abandonRun(
  ctx: AppContext,
  tx: Db,
  input: MutationInput,
  runId: string,
  request: AbandonRunRequest,
): RunMutationResponse {
  const run = loadRunFor(tx, input.installationId, runId, "abandon", request.expectedRunRevision);
  const abandoned = updateRun(tx, run, input.now, { state: "abandoned", abandonedAt: input.now });
  bumpLifecycleRevision(tx, input.installationId);
  return mutationResponse(ctx, tx, input, abandoned);
}

// --- Progression ------------------------------------------------------------------------------

/**
 * Called after a question resolution or QR validation changed the current checkpoint's facts.
 * Always increments the run revision; advances to the next checkpoint or completes the run when
 * the checkpoint's conditions hold. Completing the final checkpoint completes the run atomically.
 */
export function applyProgress(tx: Db, run: RunRow, document: HuntDocument, now: number): RunRow {
  const index = run.currentCheckpointIndex;
  const isFinalCheckpoint = index === document.checkpoints.length - 1;
  const decision = decideProgress({
    questionsResolved: countUnresolved(tx, run.id, index) === 0,
    isFinalCheckpoint,
    qrRequired: document.finale.type === "qr",
    qrValidated: isFinalCheckpoint && hasQrValidation(tx, run.id),
  });
  if (decision === "stay") return updateRun(tx, run, now);
  markCheckpointResolved(tx, run.id, index, now);
  if (decision === "advance") return updateRun(tx, run, now, { currentCheckpointIndex: index + 1 });
  const completed = updateRun(tx, run, now, { state: "completed", completedAt: now });
  bumpLifecycleRevision(tx, run.installationId);
  return completed;
}
