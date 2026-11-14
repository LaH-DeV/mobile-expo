import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AvailabilityReason } from "@signal-hunt/contracts";
import { compileHuntVersion, type CompiledHuntVersion } from "./compile";
import { ReleaseManifestSchema } from "./schema";
import { validateHuntSource, type ContentIssue } from "./validate";

const MAX_MEDIA_BYTES = 2 * 1024 * 1024;

export interface ReleaseHunt {
  huntId: string;
  currentVersion: number;
  available: boolean;
  unavailableReason: AvailabilityReason | null;
  versions: CompiledHuntVersion[];
}

export interface ContentRelease {
  synthetic: boolean;
  hunts: ReleaseHunt[];
}

export type LoadResult = { ok: true; release: ContentRelease } | { ok: false; issues: ContentIssue[] };

function readJson(file: string, issues: ContentIssue[]): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    issues.push({ path: file, message: "is missing or not valid JSON" });
    return undefined;
  }
}

/**
 * Loads and validates a private content directory:
 *
 *   release.json                     deployed availability metadata
 *   hunts/<huntId>/v<version>.json   one immutable hunt version per file
 *   media/...                        optional image files referenced by hunts
 *
 * Nothing is returned unless the whole directory is valid.
 */
export function loadContentDirectory(directory: string): LoadResult {
  const issues: ContentIssue[] = [];
  const manifestRaw = readJson(join(directory, "release.json"), issues);
  if (manifestRaw === undefined) return { ok: false, issues };
  const manifest = ReleaseManifestSchema.safeParse(manifestRaw);
  if (!manifest.success) {
    for (const issue of manifest.error.issues) {
      issues.push({ path: `release.json:${issue.path.join(".")}`, message: issue.message });
    }
    return { ok: false, issues };
  }

  const huntsDirectory = join(directory, "hunts");
  const versionsByHunt = new Map<string, CompiledHuntVersion[]>();
  const tokenOwners = new Map<string, string>();
  const huntFolders = existsSync(huntsDirectory)
    ? readdirSync(huntsDirectory, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    : [];

  for (const folder of huntFolders) {
    const files = readdirSync(join(huntsDirectory, folder.name)).filter((name) => name.endsWith(".json"));
    for (const fileName of files) {
      const label = `hunts/${folder.name}/${fileName}`;
      const raw = readJson(join(huntsDirectory, folder.name, fileName), issues);
      if (raw === undefined) continue;
      const result = validateHuntSource(raw);
      if (!result.ok) {
        for (const issue of result.issues) issues.push({ path: `${label}:${issue.path}`, message: issue.message });
        continue;
      }
      const source = result.value;
      if (source.huntId !== folder.name || fileName !== `v${source.version}.json`) {
        issues.push({ path: label, message: "file path must be hunts/<huntId>/v<version>.json for its content" });
        continue;
      }
      if (source.synthetic !== manifest.data.synthetic) {
        issues.push({ path: label, message: "synthetic flag must match release.json" });
      }
      for (const [index, media] of source.media.entries()) {
        const mediaFile = join(directory, "media", media.file);
        if (!existsSync(mediaFile) || !statSync(mediaFile).isFile()) {
          issues.push({ path: `${label}:media[${index}].file`, message: "file does not exist under media/" });
        } else if (statSync(mediaFile).size > MAX_MEDIA_BYTES) {
          issues.push({ path: `${label}:media[${index}].file`, message: "file is larger than 2 MB" });
        }
      }
      const compiled = compileHuntVersion(source);
      if (compiled.cacheVerifier) {
        const owner = tokenOwners.get(compiled.cacheVerifier.tokenHash);
        if (owner !== undefined && owner !== compiled.huntId) {
          issues.push({ path: `${label}:finale.qrToken`, message: `QR token is already bound to hunt ${owner}` });
        }
        tokenOwners.set(compiled.cacheVerifier.tokenHash, compiled.huntId);
      }
      const list = versionsByHunt.get(compiled.huntId) ?? [];
      list.push(compiled);
      versionsByHunt.set(compiled.huntId, list);
    }
  }

  const hunts: ReleaseHunt[] = [];
  for (const [huntId, entry] of Object.entries(manifest.data.hunts)) {
    const versions = (versionsByHunt.get(huntId) ?? []).sort((a, b) => a.version - b.version);
    if (!versions.some((version) => version.version === entry.currentVersion)) {
      issues.push({ path: `release.json:hunts.${huntId}.currentVersion`, message: "no file exists for this version" });
    }
    if (entry.available && entry.unavailableReason !== null) {
      issues.push({ path: `release.json:hunts.${huntId}.unavailableReason`, message: "must be null when available" });
    }
    if (!entry.available && entry.unavailableReason === null) {
      issues.push({ path: `release.json:hunts.${huntId}.unavailableReason`, message: "required when unavailable" });
    }
    hunts.push({ huntId, ...entry, versions });
  }
  for (const huntId of versionsByHunt.keys()) {
    if (!(huntId in manifest.data.hunts)) {
      issues.push({ path: `hunts/${huntId}`, message: "hunt is not listed in release.json" });
    }
  }

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, release: { synthetic: manifest.data.synthetic, hunts } };
}

export interface RegisteredVersion {
  huntId: string;
  version: number;
  digest: string;
}

/**
 * Immutable-version rules against what a database already holds: a registered version must keep
 * its digest, and a registered hunt must stay in the release (mark it unavailable instead of
 * removing it). Registered versions missing from the source directory are allowed because the
 * database keeps serving them to pinned runs.
 */
export function checkImmutability(registered: RegisteredVersion[], release: ContentRelease): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const hunts = new Map(release.hunts.map((hunt) => [hunt.huntId, hunt]));
  for (const existing of registered) {
    const hunt = hunts.get(existing.huntId);
    if (!hunt) {
      issues.push({
        path: `hunts/${existing.huntId}`,
        message: "a registered hunt was removed; keep it in release.json and mark it unavailable",
      });
      continue;
    }
    const incoming = hunt.versions.find((version) => version.version === existing.version);
    if (incoming && incoming.digest !== existing.digest) {
      issues.push({
        path: `hunts/${existing.huntId}/v${existing.version}.json`,
        message: "content of a registered immutable version changed; publish a new version instead",
      });
    }
  }
  return issues.filter(
    (issue, index) =>
      issues.findIndex((other) => other.path === issue.path && other.message === issue.message) === index,
  );
}
