import { z } from "zod";
import {
  AvailabilitySchema,
  ContentIdSchema,
  CoordinatesSchema,
  FinaleTypeSchema,
  HuntVersionSchema,
  MediaRefSchema,
  PageQuerySchema,
} from "./common";
import { LIMITS } from "./limits";
import { LocaleSchema } from "./locale";

export const DifficultySchema = z.enum(["easy", "moderate", "hard"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const HuntSummarySchema = z.object({
  id: ContentIdSchema,
  /** Currently published immutable version. */
  version: HuntVersionSchema,
  title: z.string(),
  difficulty: DifficultySchema,
  /** Author estimates, not navigation measurements. */
  estimatedLengthMeters: z.number().int().min(0),
  estimatedDurationMinutes: z.number().int().min(0),
  finaleType: FinaleTypeSchema,
  contentLocales: z.array(LocaleSchema),
  /** Public start point. Later checkpoints are never part of catalog data. */
  start: CoordinatesSchema,
  coverImage: MediaRefSchema.nullable(),
  availability: AvailabilitySchema,
});
export type HuntSummary = z.infer<typeof HuntSummarySchema>;

export const HuntDetailSchema = HuntSummarySchema.extend({
  story: z.string(),
  terrainNotes: z.string(),
  startDescription: z.string(),
  checkpointCount: z.number().int().min(1),
  requiresCamera: z.boolean(),
});
export type HuntDetail = z.infer<typeof HuntDetailSchema>;

export const ListHuntsQuerySchema = PageQuerySchema.extend({
  /** Case-insensitive substring search over titles in the request locale. */
  q: z.string().trim().max(LIMITS.searchQueryCodePoints).optional(),
});
export type ListHuntsQuery = z.infer<typeof ListHuntsQuerySchema>;

export const ListHuntsResponseSchema = z.object({
  items: z.array(HuntSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListHuntsResponse = z.infer<typeof ListHuntsResponseSchema>;

export const HuntParamsSchema = z.strictObject({ huntId: ContentIdSchema });
