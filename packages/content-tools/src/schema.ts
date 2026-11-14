import {
  AvailabilityReasonSchema,
  ContentIdSchema,
  DifficultySchema,
  HuntVersionSchema,
  LIMITS,
  PROXIMITY,
  codePointLength,
} from "@signal-hunt/contracts";
import { z } from "zod";

/** Anything that looks like markup is rejected: hunt text is plain text, never HTML. */
const MARKUP_PATTERN = /<\s*[/!]?\s*[a-zA-Z]/;

function plainText(maxCodePoints: number) {
  return z
    .string()
    .refine((value) => value.trim().length > 0, "must not be blank")
    .refine((value) => value === value.trim(), "must not have leading or trailing whitespace")
    .refine((value) => codePointLength(value) <= maxCodePoints, `must be at most ${maxCodePoints} code points`)
    .refine((value) => !MARKUP_PATTERN.test(value), "must be plain text without HTML markup");
}

/** Every localized field requires exactly the supported locales; extra or missing ones are rejected. */
function localized(maxCodePoints: number) {
  return z.strictObject({ pl: plainText(maxCodePoints), en: plainText(maxCodePoints) });
}
export type LocalizedText = { pl: string; en: string };

const MediaSchema = z.strictObject({
  id: ContentIdSchema,
  /** Path relative to the content directory's `media/` folder. */
  file: z.string().min(1).max(200),
  altText: localized(LIMITS.shortTextCodePoints),
  provenance: z.strictObject({
    source: plainText(LIMITS.shortTextCodePoints),
    license: plainText(LIMITS.shortTextCodePoints),
  }),
});

const QuestionBase = {
  id: ContentIdSchema,
  prompt: localized(LIMITS.promptCodePoints),
  image: ContentIdSchema.optional(),
  /** Ordered hints; each entry carries both locales so the sequences cannot diverge. */
  hints: z.array(localized(LIMITS.hintCodePoints)).max(LIMITS.hintsPerQuestion),
  /** Shown only after confirmed answer assistance. */
  reveal: z.strictObject({
    answerDisplay: localized(LIMITS.shortTextCodePoints),
    explanation: localized(LIMITS.revealCodePoints),
  }),
};

const TextQuestionSchema = z.strictObject({
  ...QuestionBase,
  type: z.literal("text"),
  /** Private, language-scoped accepted aliases. Authors choose them explicitly. */
  accepted: z.strictObject({
    pl: z.array(z.string()).min(1).max(LIMITS.acceptedAliasesPerLocale),
    en: z.array(z.string()).min(1).max(LIMITS.acceptedAliasesPerLocale),
  }),
});

const NumericQuestionSchema = z.strictObject({
  ...QuestionBase,
  type: z.literal("numeric"),
  /** Private decimal strings using `.` as the separator; `tolerance` is an absolute tolerance. */
  answer: z.strictObject({ value: z.string(), tolerance: z.string().optional() }),
});

const ChoiceQuestionSchema = z.strictObject({
  ...QuestionBase,
  type: z.literal("choice"),
  choices: z
    .array(
      z.strictObject({
        id: ContentIdSchema,
        text: localized(LIMITS.shortTextCodePoints),
        /** Private. Exactly one choice must be correct. */
        correct: z.boolean(),
      }),
    )
    .min(LIMITS.choicesMin)
    .max(LIMITS.choicesMax),
});

const QuestionSchema = z.discriminatedUnion("type", [TextQuestionSchema, NumericQuestionSchema, ChoiceQuestionSchema]);
export type QuestionContent = z.infer<typeof QuestionSchema>;

const CheckpointSchema = z.strictObject({
  id: ContentIdSchema,
  title: localized(LIMITS.titleCodePoints),
  location: z.strictObject({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
  radiusMeters: z
    .number()
    .int()
    .min(PROXIMITY.minRadiusMeters)
    .max(PROXIMITY.maxRadiusMeters)
    .default(PROXIMITY.defaultRadiusMeters),
  /** Required whenever the radius differs from the default. */
  radiusReason: plainText(LIMITS.shortTextCodePoints).optional(),
  drawCount: z.number().int().min(1).max(LIMITS.drawCountMax),
  questions: z.array(QuestionSchema).min(1).max(LIMITS.questionsPerPool),
});
export type CheckpointContent = z.infer<typeof CheckpointSchema>;

const HuntBase = {
  schemaVersion: z.literal(1),
  /** Marks public demonstration content whose answers and QR token are NOT secret. */
  synthetic: z.boolean().default(false),
  huntId: ContentIdSchema,
  version: HuntVersionSchema,
  title: localized(LIMITS.titleCodePoints),
  story: localized(LIMITS.storyCodePoints),
  terrainNotes: localized(LIMITS.shortTextCodePoints),
  startDescription: localized(LIMITS.shortTextCodePoints),
  difficulty: DifficultySchema,
  estimatedLengthMeters: z.number().int().min(0).max(100_000),
  estimatedDurationMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60),
  coverImage: ContentIdSchema.optional(),
  media: z.array(MediaSchema).max(100).default([]),
  /** Ordered trail. The first checkpoint is the public start; the last is the finale. */
  checkpoints: z.array(CheckpointSchema).min(1).max(LIMITS.checkpointsPerHunt),
};

/** Private authoring format of one immutable hunt version (`hunts/<huntId>/v<version>.json`). */
export const HuntSourceSchema = z.strictObject({
  ...HuntBase,
  finale: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("digital") }),
    /** Raw QR token: private in real content. Only its hash reaches the server database. */
    z.strictObject({ type: z.literal("qr"), qrToken: z.string() }),
  ]),
});
export type HuntSource = z.infer<typeof HuntSourceSchema>;

/**
 * Compiled private document stored by the server. Identical to the source except that the raw
 * QR token is removed (its hash is registered separately as the cache verifier).
 */
export const HuntDocumentSchema = z.strictObject({
  ...HuntBase,
  finale: z.strictObject({ type: z.enum(["digital", "qr"]) }),
});
export type HuntDocument = z.infer<typeof HuntDocumentSchema>;

/** Deployed availability metadata (`release.json`). */
export const ReleaseManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  synthetic: z.boolean().default(false),
  hunts: z.record(
    ContentIdSchema,
    z.strictObject({
      currentVersion: HuntVersionSchema,
      available: z.boolean(),
      unavailableReason: AvailabilityReasonSchema.nullable().default(null),
    }),
  ),
});
export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;
