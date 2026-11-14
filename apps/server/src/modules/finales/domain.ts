import { parseQrPayload } from "@signal-hunt/contracts";

/**
 * Extracts the opaque token from a scanned payload, or null when the text is not a Signal Hunt
 * QR payload. The payload is treated purely as data: URLs and arbitrary text fail the grammar
 * and are never opened or executed.
 */
export function extractScanToken(payload: string): string | null {
  return parseQrPayload(payload)?.token ?? null;
}

/** True when the token hashes to the verifier bound to the run's hunt version and finale. */
export function isBoundToken(
  token: string,
  expectedTokenHash: string,
  hashToken: (token: string) => string,
  equal: (a: string, b: string) => boolean,
): boolean {
  return equal(hashToken(token), expectedTokenHash);
}
