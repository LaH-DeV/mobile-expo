import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { canonicalJson, hashQrToken } from "@signal-hunt/content-tools";
import geodesic from "geographiclib-geodesic";

// --- Clock ------------------------------------------------------------------------------------

export interface Clock {
  /** Current time in epoch milliseconds. */
  now(): number;
}
export const systemClock: Clock = { now: () => Date.now() };

// --- Randomness -------------------------------------------------------------------------------

export interface RandomSource {
  /** Uniform integer in `[0, maxExclusive)`. */
  int(maxExclusive: number): number;
  /** URL-safe token carrying `byteLength` random bytes. */
  token(byteLength: number): string;
}

/** Cryptographic randomness (`crypto.randomInt` uses rejection sampling, so draws are unbiased). */
export const cryptoRandom: RandomSource = {
  int: (maxExclusive) => randomInt(maxExclusive),
  token: (byteLength) => randomBytes(byteLength).toString("base64url"),
};

// --- Hashing ----------------------------------------------------------------------------------

export interface Hasher {
  /** Verifier for 256-bit random secrets (credentials, deletion proofs). */
  verifier(purpose: "credential" | "deletion-proof", secret: string): string;
  qrToken(token: string): string;
  /** Keyed fingerprint of a request so low-entropy private input is not recoverable from storage. */
  fingerprint(value: unknown): string;
  equal(a: string, b: string): boolean;
}

export function createHasher(fingerprintSecret: string): Hasher {
  return {
    verifier: (purpose, secret) =>
      createHash("sha256").update(`signal-hunt:${purpose}:v1:${secret}`, "utf8").digest("hex"),
    qrToken: hashQrToken,
    fingerprint: (value) => createHmac("sha256", fingerprintSecret).update(canonicalJson(value), "utf8").digest("hex"),
    equal: (a, b) => {
      const left = Buffer.from(a, "utf8");
      const right = Buffer.from(b, "utf8");
      return left.length === right.length && timingSafeEqual(left, right);
    },
  };
}

// --- Geodesy ----------------------------------------------------------------------------------

export interface GeoPoint {
  latitude: number;
  longitude: number;
}
export type DistanceMeters = (from: GeoPoint, to: GeoPoint) => number;

/** WGS84 geodesic distance via GeographicLib (Karney's algorithm). */
export const wgs84Distance: DistanceMeters = (from, to) => {
  const result = geodesic.Geodesic.WGS84.Inverse(from.latitude, from.longitude, to.latitude, to.longitude);
  if (typeof result.s12 !== "number" || !Number.isFinite(result.s12)) {
    throw new Error("Geodesic distance could not be computed");
  }
  return result.s12;
};
