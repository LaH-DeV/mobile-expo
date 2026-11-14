import { z } from "zod";

/** Content/UI locales supported by the API. Sent as `Accept-Language: pl` or `Accept-Language: en`. */
export const SUPPORTED_LOCALES = ["pl", "en"] as const;
export const LocaleSchema = z.enum(SUPPORTED_LOCALES);
export type Locale = z.infer<typeof LocaleSchema>;

/**
 * Parses an `Accept-Language` header value. Only the exact tags from `SUPPORTED_LOCALES` are accepted
 * (case-insensitive, surrounding whitespace ignored). Lists, quality values, region subtags and
 * wildcards are rejected so the server never silently picks or mixes a translation.
 */
export function parseAcceptLanguage(header: string | undefined | null): Locale | null {
  if (typeof header !== "string") return null;
  const value = header.trim().toLowerCase();
  return SUPPORTED_LOCALES.includes(value as Locale) ? (value as Locale) : null;
}
