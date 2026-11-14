import type { ErrorCode, RunState } from "@signal-hunt/contracts";

/**
 * Run state machine:
 *
 *   start -> active;  active <-> suspended;  active|suspended -> abandoned;  active -> completed
 *
 * `completed` and `abandoned` are terminal. Replay creates a new run.
 */
export type RunAction = "gameplay" | "resume" | "suspend" | "abandon";

export function isTerminal(state: RunState): boolean {
  return state === "completed" || state === "abandoned";
}

/** Returns the error that forbids `action` in `state`, or null when the transition is allowed. */
export function transitionError(state: RunState, action: RunAction): ErrorCode | null {
  if (isTerminal(state)) return "RUN_TERMINAL";
  switch (action) {
    case "gameplay":
    case "suspend":
      return state === "active" ? null : "RUN_NOT_ACTIVE";
    case "resume":
      return state === "suspended" ? null : "RUN_NOT_SUSPENDED";
    case "abandon":
      return null;
  }
}

export interface CheckpointProgress {
  /** Every selected question of the checkpoint is resolved (correctly or with assistance). */
  questionsResolved: boolean;
  isFinalCheckpoint: boolean;
  qrRequired: boolean;
  qrValidated: boolean;
}

export type ProgressDecision = "stay" | "advance" | "complete";

/**
 * Decides what a checkpoint's facts imply. Question resolution and the QR scan are independent
 * facts; a QR finale completes only on their conjunction, in whichever order they happen.
 */
export function decideProgress(progress: CheckpointProgress): ProgressDecision {
  if (!progress.questionsResolved) return "stay";
  if (!progress.isFinalCheckpoint) return "advance";
  if (progress.qrRequired && !progress.qrValidated) return "stay";
  return "complete";
}
