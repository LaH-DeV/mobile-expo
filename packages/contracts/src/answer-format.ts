import { LIMITS } from "./limits";

/**
 * Public answer-format semantics shared by client and server. These functions describe HOW input
 * is normalized; accepted answers themselves stay private on the server.
 */

/**
 * Text answer normalization:
 *  1. Unicode NFC (canonical composition; no compatibility folding, so punctuation is preserved).
 *  2. Collapse every run of Unicode whitespace to one U+0020 and trim.
 *  3. Locale-independent case fold approximated by `toUpperCase()` then `toLowerCase()`
 *     (maps ß→ss and final sigma ς→σ; never strips diacritics: "Łódź" → "łódź", not "lodz").
 *  4. NFC again, because case mapping can produce decomposable sequences.
 */
export function normalizeAnswerText(input: string): string {
  const collapsed = input.normalize("NFC").replace(/\s+/gu, " ").trim();
  return collapsed.toUpperCase().toLowerCase().normalize("NFC");
}

export function codePointLength(value: string): number {
  let count = 0;
  for (const _char of value) count += 1;
  return count;
}

export interface ParsedDecimal {
  negative: boolean;
  /** Integer digits without leading zeros (at least "0"). */
  integer: string;
  /** Fraction digits without trailing zeros (possibly empty). */
  fraction: string;
}

const DECIMAL_PATTERN = /^(-?)(\d+)(?:[.,](\d+))?$/;

/**
 * Parses a decimal answer without binary floating point. Accepts an optional leading minus,
 * digits, and one `.` or `,` decimal separator followed by digits. Surrounding whitespace is
 * trimmed. Rejects group separators, units, exponents, a leading `+`, and bare separators.
 */
export function parseDecimalInput(input: string): ParsedDecimal | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > LIMITS.numericAnswerChars) return null;
  const match = DECIMAL_PATTERN.exec(trimmed);
  if (!match) return null;
  const integer = (match[2] ?? "0").replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const isZero = integer === "0" && fraction.length === 0;
  return { negative: match[1] === "-" && !isZero, integer, fraction };
}
