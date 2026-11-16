import { PROXIMITY, type ErrorCode } from "@signal-hunt/contracts";

export interface Fix {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAtMs: number;
}

export interface ProximityTarget {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export type ProximityFailure = Extract<
  ErrorCode,
  "LOCATION_FIX_IN_FUTURE" | "LOCATION_FIX_STALE" | "LOCATION_ACCURACY_INSUFFICIENT" | "LOCATION_TOO_FAR"
>;

type Distance = (from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) => number;

/**
 * Strict proximity gate. All four conditions are independent and inclusive at their limits:
 *
 *  - fix timestamp at most 5 s ahead of the server clock,
 *  - fix age at server receipt at most 15 s,
 *  - reported accuracy at most 25 m (accuracy never enlarges the radius),
 *  - geodesic distance to the checkpoint at most its radius.
 *
 * Returns null when the fix passes. The fix is only read here; callers must not persist it.
 */
export function checkProximity(
  fix: Fix,
  target: ProximityTarget,
  receivedAtMs: number,
  distance: Distance,
): ProximityFailure | null {
  const validNumbers =
    Number.isFinite(fix.latitude) &&
    Math.abs(fix.latitude) <= 90 &&
    Number.isFinite(fix.longitude) &&
    Math.abs(fix.longitude) <= 180 &&
    Number.isFinite(fix.accuracyMeters) &&
    fix.accuracyMeters >= 0 &&
    Number.isFinite(fix.capturedAtMs);
  if (!validNumbers) throw new RangeError("Location fix is not valid");

  const ageMs = receivedAtMs - fix.capturedAtMs;
  if (ageMs < -PROXIMITY.maxFutureSkewSeconds * 1000) return "LOCATION_FIX_IN_FUTURE";
  if (ageMs > PROXIMITY.maxFixAgeSeconds * 1000) return "LOCATION_FIX_STALE";
  if (fix.accuracyMeters > PROXIMITY.maxAccuracyMeters) return "LOCATION_ACCURACY_INSUFFICIENT";
  if (distance(fix, target) > target.radiusMeters) return "LOCATION_TOO_FAR";
  return null;
}

/** Uniform integer source, `[0, maxExclusive)`. */
type RandomInt = (maxExclusive: number) => number;

/**
 * Uniform sample of `count` distinct items in random order (partial Fisher-Yates). With an
 * unbiased `randomInt`, every ordered selection is equally likely.
 */
export function drawWithoutReplacement<T>(items: readonly T[], count: number, randomInt: RandomInt): T[] {
  if (!Number.isInteger(count) || count < 1 || count > items.length) {
    throw new RangeError("Draw count must be between 1 and the pool size");
  }
  const pool = [...items];
  for (let i = 0; i < count; i += 1) {
    const j = i + randomInt(pool.length - i);
    const picked = pool[j] as T;
    pool[j] = pool[i] as T;
    pool[i] = picked;
  }
  return pool.slice(0, count);
}

export function shuffle<T>(items: readonly T[], randomInt: RandomInt): T[] {
  return items.length === 0 ? [] : drawWithoutReplacement(items, items.length, randomInt);
}
