import {
  LIMITS,
  codePointLength,
  normalizeAnswerText,
  parseDecimalInput,
  type AnswerInput,
  type ErrorCode,
  type Locale,
  type ParsedDecimal,
} from "@signal-hunt/contracts";

/** Private evaluation configuration of one question (a structural subset of authored content). */
export type AnswerKey =
  | { type: "text"; accepted: Record<Locale, string[]> }
  | { type: "numeric"; answer: { value: string; tolerance?: string } }
  | { type: "choice"; choices: { id: string; correct: boolean }[] };

export type Evaluation =
  { ok: true; correct: boolean } | { ok: false; error: Extract<ErrorCode, "ANSWER_INVALID" | "ANSWER_TYPE_MISMATCH"> };

/** Exact decimal as an integer scaled by 10^scale. No binary floating point is involved. */
function toScaled(decimal: ParsedDecimal, scale: number): bigint {
  const magnitude = BigInt(decimal.integer + decimal.fraction.padEnd(scale, "0"));
  return decimal.negative ? -magnitude : magnitude;
}

/** |submitted - expected| <= tolerance, computed exactly. A missing tolerance means equality. */
export function decimalMatches(
  submitted: ParsedDecimal,
  expected: ParsedDecimal,
  tolerance: ParsedDecimal | null,
): boolean {
  const scale = Math.max(submitted.fraction.length, expected.fraction.length, tolerance?.fraction.length ?? 0);
  const difference = toScaled(submitted, scale) - toScaled(expected, scale);
  const magnitude = difference < 0n ? -difference : difference;
  return magnitude <= (tolerance ? toScaled(tolerance, scale) : 0n);
}

/**
 * Evaluates a submitted answer against the private key. Malformed or blank input is an input
 * error, never a wrong answer; a wrong answer is the normal result `{ ok: true, correct: false }`.
 * Text answers are compared with the aliases of the request locale only.
 */
export function evaluateAnswer(key: AnswerKey, input: AnswerInput, locale: Locale): Evaluation {
  if (key.type !== input.type) return { ok: false, error: "ANSWER_TYPE_MISMATCH" };

  if (key.type === "text" && input.type === "text") {
    const submitted = normalizeAnswerText(input.value);
    if (submitted.length === 0 || codePointLength(submitted) > LIMITS.answerTextCodePoints) {
      return { ok: false, error: "ANSWER_INVALID" };
    }
    return { ok: true, correct: key.accepted[locale].some((alias) => normalizeAnswerText(alias) === submitted) };
  }

  if (key.type === "numeric" && input.type === "numeric") {
    const submitted = parseDecimalInput(input.value);
    if (!submitted) return { ok: false, error: "ANSWER_INVALID" };
    const expected = parseDecimalInput(key.answer.value);
    const tolerance = key.answer.tolerance === undefined ? null : parseDecimalInput(key.answer.tolerance);
    if (!expected || (key.answer.tolerance !== undefined && !tolerance)) {
      throw new Error("Authored numeric answer is not a valid decimal");
    }
    return { ok: true, correct: decimalMatches(submitted, expected, tolerance) };
  }

  if (key.type === "choice" && input.type === "choice") {
    const chosen = key.choices.find((choice) => choice.id === input.choiceId);
    // A choice ID that is not part of this question is malformed input, not a wrong answer.
    if (!chosen) return { ok: false, error: "ANSWER_INVALID" };
    return { ok: true, correct: chosen.correct };
  }

  return { ok: false, error: "ANSWER_TYPE_MISMATCH" };
}
