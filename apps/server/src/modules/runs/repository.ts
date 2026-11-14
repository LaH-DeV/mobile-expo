import type { RunState } from "@signal-hunt/contracts";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../infrastructure/db/client";
import {
  runCheckpoints,
  runFinales,
  runs,
  selectedChoiceOrders,
  selectedQuestions,
} from "../../infrastructure/db/schema";

export type RunRow = typeof runs.$inferSelect;
export type RunCheckpointRow = typeof runCheckpoints.$inferSelect;
export type SelectedQuestionRow = typeof selectedQuestions.$inferSelect;

/** Ownership is part of every lookup: a run ID alone never selects a run. */
export function findOwnedRun(db: Db, installationId: string, runId: string): RunRow | undefined {
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.installationId, installationId)))
    .get();
}

export function findActiveRun(db: Db, installationId: string): RunRow | undefined {
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.installationId, installationId), eq(runs.state, "active")))
    .get();
}

export function countRunsInState(db: Db, installationId: string, state: RunState): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(runs)
    .where(and(eq(runs.installationId, installationId), eq(runs.state, state)))
    .get();
  return row?.count ?? 0;
}

export function listOwnedRuns(
  db: Db,
  installationId: string,
  states: RunState[] | null,
  limit: number,
  offset: number,
): RunRow[] {
  const owned = eq(runs.installationId, installationId);
  return db
    .select()
    .from(runs)
    .where(states ? and(owned, inArray(runs.state, states)) : owned)
    .orderBy(desc(runs.startedAt), asc(runs.id))
    .limit(limit)
    .offset(offset)
    .all();
}

export function insertRun(db: Db, row: typeof runs.$inferInsert): RunRow {
  return db.insert(runs).values(row).returning().get();
}

/** Applies a change and increments the run revision. */
export function updateRun(
  db: Db,
  run: RunRow,
  now: number,
  patch: Partial<Pick<RunRow, "state" | "currentCheckpointIndex" | "completedAt" | "abandonedAt">> = {},
): RunRow {
  return db
    .update(runs)
    .set({ ...patch, revision: run.revision + 1, updatedAt: now })
    .where(eq(runs.id, run.id))
    .returning()
    .get();
}

export interface RunProgress {
  checkpoints: RunCheckpointRow[];
  questions: SelectedQuestionRow[];
  /** Persisted choice order per selected question ID. */
  choiceOrders: Map<string, string[]>;
  qrValidatedAt: number | null;
}

export function loadProgress(db: Db, runId: string): RunProgress {
  const checkpoints = db
    .select()
    .from(runCheckpoints)
    .where(eq(runCheckpoints.runId, runId))
    .orderBy(asc(runCheckpoints.checkpointIndex))
    .all();
  const questions = db
    .select()
    .from(selectedQuestions)
    .where(eq(selectedQuestions.runId, runId))
    .orderBy(asc(selectedQuestions.checkpointIndex), asc(selectedQuestions.selectionOrder))
    .all();
  const choiceOrders = new Map<string, string[]>();
  if (questions.length > 0) {
    const rows = db
      .select()
      .from(selectedChoiceOrders)
      .where(
        inArray(
          selectedChoiceOrders.selectedQuestionId,
          questions.map((question) => question.id),
        ),
      )
      .orderBy(asc(selectedChoiceOrders.selectedQuestionId), asc(selectedChoiceOrders.position))
      .all();
    for (const row of rows) {
      const list = choiceOrders.get(row.selectedQuestionId) ?? [];
      list.push(row.choiceId);
      choiceOrders.set(row.selectedQuestionId, list);
    }
  }
  const finale = db.select().from(runFinales).where(eq(runFinales.runId, runId)).get();
  return { checkpoints, questions, choiceOrders, qrValidatedAt: finale?.qrValidatedAt ?? null };
}

export function findRunCheckpoint(db: Db, runId: string, checkpointIndex: number): RunCheckpointRow | undefined {
  return db
    .select()
    .from(runCheckpoints)
    .where(and(eq(runCheckpoints.runId, runId), eq(runCheckpoints.checkpointIndex, checkpointIndex)))
    .get();
}

export function findSelectedQuestion(db: Db, runId: string, selectedId: string): SelectedQuestionRow | undefined {
  return db
    .select()
    .from(selectedQuestions)
    .where(and(eq(selectedQuestions.id, selectedId), eq(selectedQuestions.runId, runId)))
    .get();
}

export function insertUnlock(
  db: Db,
  checkpoint: typeof runCheckpoints.$inferInsert,
  selections: { row: typeof selectedQuestions.$inferInsert; choiceOrder: string[] }[],
): void {
  db.insert(runCheckpoints).values(checkpoint).run();
  for (const selection of selections) {
    db.insert(selectedQuestions).values(selection.row).run();
    if (selection.choiceOrder.length > 0) {
      db.insert(selectedChoiceOrders)
        .values(
          selection.choiceOrder.map((choiceId, position) => ({
            selectedQuestionId: selection.row.id,
            position,
            choiceId,
          })),
        )
        .run();
    }
  }
}

export function resolveQuestion(db: Db, selectedId: string, resolution: "correct" | "assisted", now: number): void {
  db.update(selectedQuestions).set({ resolution, resolvedAt: now }).where(eq(selectedQuestions.id, selectedId)).run();
}

export function setHintsRevealed(db: Db, selectedId: string, hintsRevealed: number): void {
  db.update(selectedQuestions).set({ hintsRevealed }).where(eq(selectedQuestions.id, selectedId)).run();
}

export function markCheckpointResolved(db: Db, runId: string, checkpointIndex: number, now: number): void {
  db.update(runCheckpoints)
    .set({ resolvedAt: now })
    .where(and(eq(runCheckpoints.runId, runId), eq(runCheckpoints.checkpointIndex, checkpointIndex)))
    .run();
}

export function insertQrValidation(db: Db, runId: string, now: number): void {
  db.insert(runFinales).values({ runId, qrValidatedAt: now }).run();
}

export function hasQrValidation(db: Db, runId: string): boolean {
  return db.select({ runId: runFinales.runId }).from(runFinales).where(eq(runFinales.runId, runId)).get() !== undefined;
}

export function countUnresolved(db: Db, runId: string, checkpointIndex: number): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(selectedQuestions)
    .where(
      and(
        eq(selectedQuestions.runId, runId),
        eq(selectedQuestions.checkpointIndex, checkpointIndex),
        eq(selectedQuestions.resolution, "unresolved"),
      ),
    )
    .get();
  return row?.count ?? 0;
}
