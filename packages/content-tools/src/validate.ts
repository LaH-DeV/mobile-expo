import {
  LIMITS,
  PROXIMITY,
  QR_TOKEN_PATTERN,
  SUPPORTED_LOCALES,
  codePointLength,
  normalizeAnswerText,
  parseDecimalInput,
} from "@signal-hunt/contracts";
import { HuntSourceSchema, type HuntSource } from "./schema";

export interface ContentIssue {
  /** Location of the problem, for example `checkpoints[1].questions[0].accepted.pl[2]`. */
  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ContentIssue[] };

const AUTHORED_DECIMAL = /^-?\d+(\.\d+)?$/;
const MEDIA_FILE = /^[a-z0-9][a-z0-9._/-]*\.(jpg|jpeg|png|webp)$/;

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((out, part) => {
    if (typeof part === "number") return `${out}[${part}]`;
    return out.length === 0 ? String(part) : `${out}.${String(part)}`;
  }, "");
}

export function isSafeMediaFile(file: string): boolean {
  if (!MEDIA_FILE.test(file)) return false;
  return !file.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

/** Validates one private hunt version file. Never includes answer or token values in messages. */
export function validateHuntSource(raw: unknown): ValidationResult<HuntSource> {
  const parsed = HuntSourceSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })),
    };
  }
  const hunt = parsed.data;
  const issues: ContentIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  const mediaIds = new Set<string>();
  hunt.media.forEach((media, index) => {
    if (mediaIds.has(media.id)) add(`media[${index}].id`, "duplicate media ID");
    mediaIds.add(media.id);
    if (!isSafeMediaFile(media.file)) {
      add(`media[${index}].file`, "must be a relative lower-case .jpg/.jpeg/.png/.webp path without traversal");
    }
  });
  if (hunt.coverImage !== undefined && !mediaIds.has(hunt.coverImage)) {
    add("coverImage", "references an undeclared media ID");
  }

  if (hunt.finale.type === "qr" && !QR_TOKEN_PATTERN.test(hunt.finale.qrToken)) {
    add("finale.qrToken", "must be 22-86 base64url characters (at least 128 random bits)");
  }

  const checkpointIds = new Set<string>();
  const questionIds = new Set<string>();
  hunt.checkpoints.forEach((checkpoint, ci) => {
    const cp = `checkpoints[${ci}]`;
    if (checkpointIds.has(checkpoint.id)) add(`${cp}.id`, "duplicate checkpoint ID");
    checkpointIds.add(checkpoint.id);

    if (checkpoint.radiusMeters !== PROXIMITY.defaultRadiusMeters && checkpoint.radiusReason === undefined) {
      add(`${cp}.radiusReason`, `required when radiusMeters differs from ${PROXIMITY.defaultRadiusMeters}`);
    }
    if (checkpoint.drawCount > checkpoint.questions.length) {
      add(`${cp}.drawCount`, "must not exceed the question pool size");
    }

    checkpoint.questions.forEach((question, qi) => {
      const qp = `${cp}.questions[${qi}]`;
      if (questionIds.has(question.id)) add(`${qp}.id`, "duplicate question ID within the hunt");
      questionIds.add(question.id);
      if (question.image !== undefined && !mediaIds.has(question.image)) {
        add(`${qp}.image`, "references an undeclared media ID");
      }

      if (question.type === "text") {
        for (const locale of SUPPORTED_LOCALES) {
          const seen = new Set<string>();
          question.accepted[locale].forEach((alias, ai) => {
            const ap = `${qp}.accepted.${locale}[${ai}]`;
            const normalized = normalizeAnswerText(alias);
            if (normalized.length === 0) add(ap, "alias is blank after normalization");
            else if (codePointLength(normalized) > LIMITS.answerTextCodePoints) add(ap, "alias is too long");
            else if (seen.has(normalized)) add(ap, "duplicates another alias after normalization");
            seen.add(normalized);
          });
        }
      } else if (question.type === "numeric") {
        if (!AUTHORED_DECIMAL.test(question.answer.value) || parseDecimalInput(question.answer.value) === null) {
          add(`${qp}.answer.value`, "must be a plain decimal such as 12 or 3.5 (dot separator, no grouping/units)");
        }
        const tolerance = question.answer.tolerance;
        if (tolerance !== undefined) {
          const parsedTolerance = AUTHORED_DECIMAL.test(tolerance) ? parseDecimalInput(tolerance) : null;
          if (parsedTolerance === null) add(`${qp}.answer.tolerance`, "must be a plain decimal");
          else if (parsedTolerance.negative) add(`${qp}.answer.tolerance`, "must not be negative");
        }
      } else {
        const choiceIds = new Set<string>();
        question.choices.forEach((choice, chi) => {
          if (choiceIds.has(choice.id)) add(`${qp}.choices[${chi}].id`, "duplicate choice ID");
          choiceIds.add(choice.id);
        });
        const correct = question.choices.filter((choice) => choice.correct).length;
        if (correct !== 1) add(`${qp}.choices`, "exactly one choice must be marked correct");
      }
    });
  });

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: hunt };
}
