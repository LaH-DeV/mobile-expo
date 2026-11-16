import type {
  Availability,
  Locale,
  MediaRef,
  RevealedCheckpoint,
  RunSnapshot,
  RunSummary,
  SelectedQuestion,
} from "@signal-hunt/contracts";
import type { AppContext } from "../../infrastructure/context";
import type { Db } from "../../infrastructure/db/client";
import type { HuntDocument, QuestionContent } from "../content/store";
import { loadProgress, type RunProgress, type RunRow, type SelectedQuestionRow } from "./repository";

const iso = (ms: number) => new Date(ms).toISOString();
const isoOrNull = (ms: number | null) => (ms === null ? null : iso(ms));

export function mediaRef(document: HuntDocument, mediaId: string | undefined, locale: Locale): MediaRef | null {
  if (mediaId === undefined) return null;
  const media = document.media.find((entry) => entry.id === mediaId);
  return media ? { mediaId: media.id, altText: media.altText[locale] } : null;
}

/**
 * Public view of one selected question, built field by field from private content. Accepted
 * answers, tolerance, correctness flags and hints beyond the cursor are never read into it.
 */
function toSelectedQuestion(
  document: HuntDocument,
  content: QuestionContent,
  row: SelectedQuestionRow,
  choiceOrder: string[] | undefined,
  locale: Locale,
): SelectedQuestion {
  let choices: SelectedQuestion["choices"] = null;
  if (content.type === "choice") {
    const byId = new Map(content.choices.map((choice) => [choice.id, choice.text[locale]]));
    choices = (choiceOrder ?? []).map((id) => ({ id, text: byId.get(id) ?? "" }));
  }
  return {
    selectedId: row.id,
    type: content.type,
    prompt: content.prompt[locale],
    image: mediaRef(document, content.image, locale),
    choices,
    resolution: row.resolution,
    resolvedAt: isoOrNull(row.resolvedAt),
    revealedHints: content.hints.slice(0, row.hintsRevealed).map((hint) => hint[locale]),
    hasMoreHints: row.resolution === "unresolved" && row.hintsRevealed < content.hints.length,
    assistance:
      row.resolution === "assisted"
        ? { answerDisplay: content.reveal.answerDisplay[locale], explanation: content.reveal.explanation[locale] }
        : null,
  };
}

function commonFields(
  run: RunRow,
  document: HuntDocument,
  progress: RunProgress,
  availability: Availability,
  locale: Locale,
) {
  return {
    id: run.id,
    state: run.state,
    revision: run.revision,
    huntId: run.huntId,
    huntVersion: run.huntVersion,
    huntTitle: document.title[locale],
    finaleType: document.finale.type,
    availability,
    checkpointCount: document.checkpoints.length,
    resolvedCheckpointCount: progress.checkpoints.filter((checkpoint) => checkpoint.resolvedAt !== null).length,
    hintsUsed: progress.questions.reduce((sum, question) => sum + question.hintsRevealed, 0),
    assistedQuestionCount: progress.questions.filter((question) => question.resolution === "assisted").length,
    startedAt: iso(run.startedAt),
    updatedAt: iso(run.updatedAt),
    completedAt: isoOrNull(run.completedAt),
    abandonedAt: isoOrNull(run.abandonedAt),
  };
}

function availabilityOf(ctx: AppContext, db: Db, huntId: string): Availability {
  return ctx.content.findHunt(db, huntId)?.availability ?? { available: false, reasonCode: "withdrawn" };
}

export function buildRunSummary(ctx: AppContext, db: Db, run: RunRow, locale: Locale): RunSummary {
  const document = ctx.content.getDocument(db, run.huntId, run.huntVersion);
  return commonFields(run, document, loadProgress(db, run.id), availabilityOf(ctx, db, run.huntId), locale);
}

/**
 * Safe authoritative snapshot. Only checkpoints up to the current index are read from the
 * private document, so later coordinates and pools cannot leak; questions appear only for
 * unlocked checkpoints and only the persisted selection.
 */
export function buildRunSnapshot(ctx: AppContext, db: Db, run: RunRow, locale: Locale): RunSnapshot {
  const document = ctx.content.getDocument(db, run.huntId, run.huntVersion);
  const progress = loadProgress(db, run.id);
  const lastIndex = document.checkpoints.length - 1;
  const unlockedByIndex = new Map(progress.checkpoints.map((row) => [row.checkpointIndex, row]));

  const checkpoints: RevealedCheckpoint[] = [];
  for (let index = 0; index <= Math.min(run.currentCheckpointIndex, lastIndex); index += 1) {
    const content = document.checkpoints[index];
    if (!content) break;
    const unlocked = unlockedByIndex.get(index);
    checkpoints.push({
      id: content.id,
      order: index + 1,
      title: content.title[locale],
      state: !unlocked ? "reachable" : unlocked.resolvedAt === null ? "unlocked" : "resolved",
      location: { latitude: content.location.latitude, longitude: content.location.longitude },
      radiusMeters: content.radiusMeters,
      isFinale: index === lastIndex,
      unlockedAt: isoOrNull(unlocked?.unlockedAt ?? null),
      resolvedAt: isoOrNull(unlocked?.resolvedAt ?? null),
      questions: progress.questions
        .filter((row) => row.checkpointIndex === index)
        .map((row) =>
          toSelectedQuestion(
            document,
            ctx.content.getQuestion(document, row.questionId),
            row,
            progress.choiceOrders.get(row.id),
            locale,
          ),
        ),
    });
  }

  const finaleQuestions = progress.questions.filter((row) => row.checkpointIndex === lastIndex);
  const qrRequired = document.finale.type === "qr";
  return {
    ...commonFields(run, document, progress, availabilityOf(ctx, db, run.huntId), locale),
    checkpoints,
    finale: {
      type: document.finale.type,
      unlocked: unlockedByIndex.has(lastIndex),
      questionsResolved:
        finaleQuestions.length > 0 && finaleQuestions.every((question) => question.resolution !== "unresolved"),
      qrRequired,
      qrValidated: progress.qrValidatedAt !== null,
      qrValidatedAt: isoOrNull(progress.qrValidatedAt),
    },
  };
}
