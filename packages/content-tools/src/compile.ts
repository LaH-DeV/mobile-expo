import { createHash } from "node:crypto";
import { HuntDocumentSchema, type HuntDocument, type HuntSource } from "./schema";

/** SHA-256 of a QR token. Tokens carry at least 128 random bits, so a plain digest is sufficient. */
export function hashQrToken(token: string): string {
  return createHash("sha256").update(`signal-hunt:qr-token:v1:${token}`, "utf8").digest("hex");
}

/** Deterministic JSON with recursively sorted object keys, used for content digests. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

export interface CompiledHuntVersion {
  huntId: string;
  version: number;
  /** SHA-256 over the canonical compiled document and the cache-verifier hash. */
  digest: string;
  /** Private server document without the raw QR token. */
  document: HuntDocument;
  cacheVerifier: { checkpointId: string; tokenHash: string } | null;
}

/** Turns a validated source into the immutable artifact registered by the server. */
export function compileHuntVersion(source: HuntSource): CompiledHuntVersion {
  const { finale, ...rest } = source;
  const document = HuntDocumentSchema.parse({ ...rest, finale: { type: finale.type } });
  const lastCheckpoint = document.checkpoints[document.checkpoints.length - 1];
  if (!lastCheckpoint) throw new Error("A hunt needs at least one checkpoint");
  const cacheVerifier =
    finale.type === "qr" ? { checkpointId: lastCheckpoint.id, tokenHash: hashQrToken(finale.qrToken) } : null;
  const digest = createHash("sha256").update(canonicalJson({ document, cacheVerifier }), "utf8").digest("hex");
  return { huntId: document.huntId, version: document.version, digest, document, cacheVerifier };
}
