import type { RunMutationResponse, ScanFinaleRequest } from "@signal-hunt/contracts";
import type { AppContext } from "../../infrastructure/context";
import type { Db } from "../../infrastructure/db/client";
import { AppError } from "../../infrastructure/errors";
import { requireProximity } from "../checkpoints/use-cases";
import { findRunCheckpoint, hasQrValidation, insertQrValidation } from "../runs/repository";
import { applyProgress, loadRunForGameplay, mutationResponse, type MutationInput } from "../runs/use-cases";
import { extractScanToken, isBoundToken } from "./domain";

/**
 * Validates a scanned QR payload for a QR-finale run. Requires the final checkpoint to be
 * unlocked, a fresh fix under the final checkpoint's location rules, and a token bound to this
 * run's hunt version. Only the validation fact is stored; completion additionally needs every
 * final question resolved.
 */
export function scanFinale(
  ctx: AppContext,
  tx: Db,
  input: MutationInput,
  runId: string,
  request: ScanFinaleRequest,
): RunMutationResponse {
  const { run, document } = loadRunForGameplay(ctx, tx, input.installationId, runId, request.expectedRunRevision);
  if (document.finale.type !== "qr") throw new AppError("FINALE_NOT_QR");
  const finalIndex = document.checkpoints.length - 1;
  const finalCheckpoint = document.checkpoints[finalIndex];
  if (!finalCheckpoint || run.currentCheckpointIndex !== finalIndex || !findRunCheckpoint(tx, run.id, finalIndex)) {
    throw new AppError("FINALE_NOT_UNLOCKED");
  }
  if (hasQrValidation(tx, run.id)) throw new AppError("QR_ALREADY_VALIDATED");

  const expectedHash = ctx.content.findCacheTokenHash(tx, run.huntId, run.huntVersion);
  if (expectedHash === undefined) throw new Error("QR finale has no registered cache verifier");
  // Format first (no location needed to reject garbage), then proximity, then the binding.
  const token = extractScanToken(request.payload);
  if (token === null) throw new AppError("QR_FORMAT_INVALID");
  requireProximity(ctx, request.location, finalCheckpoint, input.now);
  if (!isBoundToken(token, expectedHash, ctx.hasher.qrToken, ctx.hasher.equal)) throw new AppError("QR_WRONG_CACHE");

  insertQrValidation(tx, run.id, input.now);
  return mutationResponse(ctx, tx, input, applyProgress(tx, run, document, input.now));
}
