import type { HuntDetail, HuntSummary, ListHuntsQuery, ListHuntsResponse, Locale } from "@signal-hunt/contracts";
import { SUPPORTED_LOCALES } from "@signal-hunt/contracts";
import type { AppContext } from "../../infrastructure/context";
import { AppError } from "../../infrastructure/errors";
import type { HuntDocument, HuntRecord } from "../content/store";
import { mediaRef } from "../runs/snapshot";
import { decodeOffset, encodeOffset } from "../runs/use-cases";

/** Allowlisted public metadata. Only the first checkpoint's location (the public start) is read. */
function toSummary(hunt: HuntRecord, document: HuntDocument, locale: Locale): HuntSummary {
  const start = document.checkpoints[0];
  if (!start) throw new Error("Registered hunt has no checkpoints");
  return {
    id: hunt.id,
    version: document.version,
    title: document.title[locale],
    difficulty: document.difficulty,
    estimatedLengthMeters: document.estimatedLengthMeters,
    estimatedDurationMinutes: document.estimatedDurationMinutes,
    finaleType: document.finale.type,
    contentLocales: [...SUPPORTED_LOCALES],
    start: { latitude: start.location.latitude, longitude: start.location.longitude },
    coverImage: mediaRef(document, document.coverImage, locale),
    availability: hunt.availability,
  };
}

export function listHunts(ctx: AppContext, query: ListHuntsQuery, locale: Locale): ListHuntsResponse {
  const db = ctx.database.db;
  const needle = query.q ? query.q.toLocaleLowerCase(locale) : null;
  const matches = ctx.content
    .listHunts(db)
    .filter((hunt) => hunt.availability.available)
    .map((hunt) => toSummary(hunt, ctx.content.getDocument(db, hunt.id, hunt.currentVersion), locale))
    .filter((summary) => needle === null || summary.title.toLocaleLowerCase(locale).includes(needle));
  const offset = decodeOffset(query.cursor);
  return {
    items: matches.slice(offset, offset + query.limit),
    nextCursor: offset + query.limit < matches.length ? encodeOffset(offset + query.limit) : null,
  };
}

/** Details stay readable for an unavailable hunt so the client can show the reason. */
export function getHunt(ctx: AppContext, huntId: string, locale: Locale): HuntDetail {
  const db = ctx.database.db;
  const hunt = ctx.content.findHunt(db, huntId);
  if (!hunt) throw new AppError("NOT_FOUND");
  const document = ctx.content.getDocument(db, hunt.id, hunt.currentVersion);
  return {
    ...toSummary(hunt, document, locale),
    story: document.story[locale],
    terrainNotes: document.terrainNotes[locale],
    startDescription: document.startDescription[locale],
    checkpointCount: document.checkpoints.length,
    requiresCamera: document.finale.type === "qr",
  };
}
