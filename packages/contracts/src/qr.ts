/**
 * QR finale payload grammar, version 1:
 *
 *   signal-hunt:qr:v1:<token>
 *
 * `<token>` is 22-86 base64url characters (at least 128 bits of entropy; fixtures use 256 bits).
 * The payload is never a URL and is never opened or executed. The token is opaque: only the
 * server can decide whether it belongs to a run's finale.
 */
export const QR_PAYLOAD_PREFIX = "signal-hunt:qr:v1:";
export const QR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,86}$/;

export interface ParsedQrPayload {
  version: 1;
  token: string;
}

export function parseQrPayload(payload: string): ParsedQrPayload | null {
  if (!payload.startsWith(QR_PAYLOAD_PREFIX)) return null;
  const token = payload.slice(QR_PAYLOAD_PREFIX.length);
  return QR_TOKEN_PATTERN.test(token) ? { version: 1, token } : null;
}

export function formatQrPayload(token: string): string {
  if (!QR_TOKEN_PATTERN.test(token)) throw new Error("Invalid QR token");
  return `${QR_PAYLOAD_PREFIX}${token}`;
}
