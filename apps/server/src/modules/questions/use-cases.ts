import type {
  AnswerQuestionRequest,
  AnswerQuestionResponse,
  RevealAnswerRequest,
  RevealAnswerResponse,
  RevealHintRequest,
  RevealHintResponse,
} from "@signal-hunt/contracts";
import type { AppContext } from "../../infrastructure/context";
import type { Db } from "../../infrastructure/db/client";
import { AppError } from "../../infrastructure/errors";
import {
  findSelectedQuestion,
  resolveQuestion,
  setHintsRevealed,
  updateRun,
  type RunRow,
  type SelectedQuestionRow,
} from "../runs/repository";
import { applyProgress, loadRunForGameplay, mutationResponse, type MutationInput } from "../runs/use-cases";
import type { HuntDocument, QuestionContent } from "../content/store";
import { evaluateAnswer } from "./domain";

interface QuestionTarget {
  run: RunRow;
  document: HuntDocument;
  selected: SelectedQuestionRow;
  content: QuestionContent;
}

/**
 * A selected question exists only after its checkpoint was unlocked by a valid proximity check,
 * so reaching it here already implies the location prerequisite. It must belong to the owned run
 * and still be unresolved.
 */
function loadUnresolvedQuestion(
  ctx: AppContext,
  tx: Db,
  input: MutationInput,
  runId: string,
  selectedId: string,
  expectedRunRevision: number,
): QuestionTarget {
  const { run, document } = loadRunForGameplay(ctx, tx, input.installationId, runId, expectedRunRevision);
  const selected = findSelectedQuestion(tx, run.id, selectedId);
  if (!selected) throw new AppError("NOT_FOUND");
  if (selected.resolution !== "unresolved") throw new AppError("QUESTION_ALREADY_RESOLVED");
  return { run, document, selected, content: ctx.content.getQuestion(document, selected.questionId) };
}

export function answerQuestion(
  ctx: AppContext,
  tx: Db,
  input: MutationInput,
  runId: string,
  selectedId: string,
  request: AnswerQuestionRequest,
): AnswerQuestionResponse {
  const target = loadUnresolvedQuestion(ctx, tx, input, runId, selectedId, request.expectedRunRevision);
  const evaluation = evaluateAnswer(target.content, request.answer, input.locale);
  if (!evaluation.ok) throw new AppError(evaluation.error);
  if (!evaluation.correct) {
    // A wrong answer changes nothing: no revision bump, unlimited further attempts.
    return { ...mutationResponse(ctx, tx, input, target.run), evaluation: { result: "incorrect" } };
  }
  resolveQuestion(tx, target.selected.id, "correct", input.now);
  const run = applyProgress(tx, target.run, target.document, input.now);
  return { ...mutationResponse(ctx, tx, input, run), evaluation: { result: "correct" } };
}

/** Reveals exactly the next authored hint and persists the cursor. Hints never resolve a question. */
export function revealHint(
  ctx: AppContext,
  tx: Db,
  input: MutationInput,
  runId: string,
  selectedId: string,
  request: RevealHintRequest,
): RevealHintResponse {
  const target = loadUnresolvedQuestion(ctx, tx, input, runId, selectedId, request.expectedRunRevision);
  const hint = target.content.hints[target.selected.hintsRevealed];
  if (!hint) throw new AppError("NO_HINTS_REMAINING");
  const position = target.selected.hintsRevealed + 1;
  setHintsRevealed(tx, target.selected.id, position);
  const run = updateRun(tx, target.run, input.now);
  return { ...mutationResponse(ctx, tx, input, run), hint: { position, text: hint[input.locale] } };
}

/**
 * Confirmed answer assistance: resolves the selected question as assisted and returns the
 * authored answer display. It cannot satisfy a location gate or a required QR scan.
 */
export function revealAnswer(
  ctx: AppContext,
  tx: Db,
  input: MutationInput,
  runId: string,
  selectedId: string,
  request: RevealAnswerRequest,
): RevealAnswerResponse {
  const target = loadUnresolvedQuestion(ctx, tx, input, runId, selectedId, request.expectedRunRevision);
  resolveQuestion(tx, target.selected.id, "assisted", input.now);
  const run = applyProgress(tx, target.run, target.document, input.now);
  return {
    ...mutationResponse(ctx, tx, input, run),
    assistance: {
      answerDisplay: target.content.reveal.answerDisplay[input.locale],
      explanation: target.content.reveal.explanation[input.locale],
    },
  };
}
