import {
  PROXIMITY,
  type LocationFix,
  type RunMutationResponse,
  type UnlockCheckpointRequest,
} from "@signal-hunt/contracts";
import type { AppContext } from "../../infrastructure/context";
import type { Db } from "../../infrastructure/db/client";
import { AppError } from "../../infrastructure/errors";
import type { CheckpointContent } from "../content/store";
import { findRunCheckpoint, insertUnlock, updateRun } from "../runs/repository";
import { loadRunForGameplay, mutationResponse, type MutationInput } from "../runs/use-cases";
import { checkProximity, drawWithoutReplacement, shuffle } from "./domain";

const PROXIMITY_PARAMS = {
  LOCATION_FIX_IN_FUTURE: { maxFutureSkewSeconds: PROXIMITY.maxFutureSkewSeconds },
  LOCATION_FIX_STALE: { maxFixAgeSeconds: PROXIMITY.maxFixAgeSeconds },
  LOCATION_ACCURACY_INSUFFICIENT: { maxAccuracyMeters: PROXIMITY.maxAccuracyMeters },
  LOCATION_TOO_FAR: {},
} as const;

/**
 * Validates a submitted fix against a checkpoint and throws the matching 422. The fix is used
 * only for this comparison: it is not stored, logged or echoed back.
 */
export function requireProximity(
  ctx: AppContext,
  location: LocationFix,
  checkpoint: CheckpointContent,
  receivedAt: number,
): void {
  const failure = checkProximity(
    {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyMeters: location.accuracyMeters,
      capturedAtMs: Date.parse(location.capturedAt),
    },
    { ...checkpoint.location, radiusMeters: checkpoint.radiusMeters },
    receivedAt,
    ctx.distance,
  );
  if (failure) {
    const params =
      failure === "LOCATION_TOO_FAR" ? { radiusMeters: checkpoint.radiusMeters } : PROXIMITY_PARAMS[failure];
    throw new AppError(failure, params);
  }
}

/**
 * First valid unlock of the current checkpoint: draws distinct questions uniformly, fixes each
 * choice order once, and persists both with the unlock fact in the caller's transaction.
 */
export function unlockCheckpoint(
  ctx: AppContext,
  tx: Db,
  input: MutationInput,
  runId: string,
  checkpointId: string,
  request: UnlockCheckpointRequest,
): RunMutationResponse {
  const { run, document } = loadRunForGameplay(ctx, tx, input.installationId, runId, request.expectedRunRevision);
  const index = run.currentCheckpointIndex;
  const checkpoint = document.checkpoints[index];
  // Any ID other than the current target gets the same answer, whether or not it exists later.
  if (!checkpoint || checkpoint.id !== checkpointId) throw new AppError("CHECKPOINT_NOT_REACHABLE");
  if (findRunCheckpoint(tx, run.id, index)) throw new AppError("CHECKPOINT_ALREADY_UNLOCKED");
  requireProximity(ctx, request.location, checkpoint, input.now);

  const drawn = drawWithoutReplacement(checkpoint.questions, checkpoint.drawCount, ctx.random.int);
  insertUnlock(
    tx,
    { runId: run.id, checkpointIndex: index, checkpointId: checkpoint.id, unlockedAt: input.now },
    drawn.map((question, selectionOrder) => ({
      row: {
        id: `sq_${ctx.random.token(16)}`,
        runId: run.id,
        checkpointIndex: index,
        selectionOrder,
        questionId: question.id,
        resolution: "unresolved" as const,
        hintsRevealed: 0,
      },
      choiceOrder:
        question.type === "choice"
          ? shuffle(
              question.choices.map((choice) => choice.id),
              ctx.random.int,
            )
          : [],
    })),
  );
  return mutationResponse(ctx, tx, input, updateRun(tx, run, input.now));
}
