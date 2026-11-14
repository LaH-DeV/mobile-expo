import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkImmutability,
  compileHuntVersion,
  hashQrToken,
  loadContentDirectory,
  validateHuntSource,
} from "../src/index";

const SYNTHETIC = resolve(import.meta.dirname, "../../../content/synthetic");

type Json = any;
const fixture = (huntId: string): Json => JSON.parse(readFileSync(join(SYNTHETIC, "hunts", huntId, "v1.json"), "utf8"));

function issuesFor(mutate: (hunt: Json) => void, huntId = "demo-square"): string[] {
  const hunt = fixture(huntId);
  mutate(hunt);
  const result = validateHuntSource(hunt);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
}

const temporary: string[] = [];
function copyOfSynthetic(): string {
  const directory = mkdtempSync(join(tmpdir(), "signal-hunt-content-"));
  temporary.push(directory);
  cpSync(SYNTHETIC, directory, { recursive: true });
  return directory;
}
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("synthetic fixtures", () => {
  it("validate and cover both finale types in both locales", () => {
    const loaded = loadContentDirectory(SYNTHETIC);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.release.synthetic).toBe(true);
    const finales = loaded.release.hunts.map((hunt) => hunt.versions[0]?.document.finale.type).sort();
    expect(finales).toEqual(["digital", "qr"]);
  });

  it("match the documented example structure (pool/draw counts)", () => {
    const hunt = fixture("demo-square");
    expect(hunt.checkpoints.map((c: Json) => [c.id, c.questions.length, c.drawCount])).toEqual([
      ["gate", 2, 1],
      ["clock", 2, 1],
      ["pavilion", 2, 2],
    ]);
  });
});

describe("compilation", () => {
  it("removes the raw QR token and registers only its hash", () => {
    const source = validateHuntSource(fixture("demo-square"));
    expect(source.ok).toBe(true);
    if (!source.ok || source.value.finale.type !== "qr") return;
    const compiled = compileHuntVersion(source.value);
    const token = source.value.finale.qrToken;
    expect(JSON.stringify(compiled)).not.toContain(token);
    expect(compiled.cacheVerifier).toEqual({ checkpointId: "pavilion", tokenHash: hashQrToken(token) });
    expect(compiled.document.finale).toEqual({ type: "qr" });
  });

  it("produces a stable digest that changes with content or token", () => {
    const parse = (hunt: Json) => {
      const result = validateHuntSource(hunt);
      if (!result.ok) throw new Error("invalid");
      return compileHuntVersion(result.value).digest;
    };
    const base = parse(fixture("demo-square"));
    expect(parse(fixture("demo-square"))).toBe(base);
    const edited = fixture("demo-square");
    edited.checkpoints[0].questions[1].answer.value = "1925";
    expect(parse(edited)).not.toBe(base);
    const retokened = fixture("demo-square");
    retokened.finale.qrToken = "B".repeat(43);
    expect(parse(retokened)).not.toBe(base);
  });
});

describe("validation rejects", () => {
  it.each<[string, (hunt: Json) => void, RegExp]>([
    ["duplicate checkpoint ID", (h) => (h.checkpoints[1].id = "gate"), /duplicate checkpoint ID/],
    ["duplicate question ID", (h) => (h.checkpoints[1].questions[0].id = "gate.date"), /duplicate question ID/],
    ["missing ID", (h) => delete h.checkpoints[0].id, /checkpoints\[0\]\.id/],
    ["invalid ID", (h) => (h.huntId = "Demo Square"), /huntId/],
    ["empty pool", (h) => (h.checkpoints[0].questions = []), /checkpoints\[0\]\.questions/],
    ["zero draw count", (h) => (h.checkpoints[0].drawCount = 0), /drawCount/],
    ["draw count above pool", (h) => (h.checkpoints[0].drawCount = 3), /must not exceed the question pool/],
    ["draw count above limit", (h) => (h.checkpoints[0].drawCount = 6), /drawCount/],
    ["no checkpoints", (h) => (h.checkpoints = []), /checkpoints/],
    ["latitude out of range", (h) => (h.checkpoints[0].location.latitude = 90.1), /latitude/],
    ["longitude out of range", (h) => (h.checkpoints[0].location.longitude = -180.5), /longitude/],
    ["radius below minimum", (h) => (h.checkpoints[0].radiusMeters = 14), /radiusMeters/],
    ["radius above maximum", (h) => (h.checkpoints[0].radiusMeters = 151), /radiusMeters/],
    ["radius change without reason", (h) => (h.checkpoints[0].radiusMeters = 60), /radiusReason/],
    ["negative estimate", (h) => (h.estimatedLengthMeters = -1), /estimatedLengthMeters/],
    ["negative tolerance", (h) => (h.checkpoints[0].questions[1].answer.tolerance = "-0.5"), /must not be negative/],
    ["comma in authored decimal", (h) => (h.checkpoints[0].questions[1].answer.value = "19,24"), /plain decimal/],
    ["grouped authored decimal", (h) => (h.checkpoints[0].questions[1].answer.value = "1 924"), /plain decimal/],
    ["unit in authored decimal", (h) => (h.checkpoints[0].questions[1].answer.value = "3m"), /plain decimal/],
    ["no correct choice", (h) => (h.checkpoints[0].questions[0].choices[0].correct = false), /exactly one choice/],
    ["two correct choices", (h) => (h.checkpoints[0].questions[0].choices[1].correct = true), /exactly one choice/],
    ["duplicate choice ID", (h) => (h.checkpoints[0].questions[0].choices[1].id = "star"), /duplicate choice ID/],
    ["single choice", (h) => h.checkpoints[0].questions[0].choices.splice(1), /choices/],
    ["blank alias", (h) => h.checkpoints[1].questions[0].accepted.pl.push("  "), /blank after normalization/],
    [
      "duplicate alias after folding",
      (h) => h.checkpoints[1].questions[0].accepted.en.push(" COPPER "),
      /duplicates another alias/,
    ],
    ["missing locale aliases", (h) => (h.checkpoints[1].questions[0].accepted.en = []), /accepted\.en/],
    ["missing English prompt", (h) => delete h.checkpoints[0].questions[0].prompt.en, /prompt\.en/],
    ["blank Polish hint", (h) => (h.checkpoints[0].questions[0].hints[0].pl = " "), /hints\[0\]\.pl/],
    [
      "missing reveal text",
      (h) => delete h.checkpoints[0].questions[0].reveal.explanation.pl,
      /reveal\.explanation\.pl/,
    ],
    [
      "missing choice translation",
      (h) => delete h.checkpoints[0].questions[0].choices[0].text.en,
      /choices\[0\]\.text\.en/,
    ],
    ["unsupported locale", (h) => (h.title.de = "Geheimnis"), /title/],
    ["HTML in story", (h) => (h.story.en = "Hello <script>alert(1)</script>"), /plain text/],
    ["HTML in prompt", (h) => (h.checkpoints[0].questions[0].prompt.pl = "<b>Jaki</b> znak?"), /plain text/],
    ["too many hints", (h) => (h.checkpoints[0].questions[0].hints = Array(6).fill({ pl: "a", en: "b" })), /hints/],
    ["short QR token", (h) => (h.finale.qrToken = "abc"), /qrToken/],
    ["URL as QR token", (h) => (h.finale.qrToken = "https://example.com/cache"), /qrToken/],
    ["missing QR token", (h) => delete h.finale.qrToken, /finale/],
    ["unknown field", (h) => (h.checkpoints[0].skipLocation = true), /checkpoints\[0\]/],
    ["undeclared cover image", (h) => (h.coverImage = "cover"), /undeclared media/],
    [
      "media without alt text",
      (h) =>
        (h.media = [
          {
            id: "cover",
            file: "cover.png",
            altText: { pl: "Okładka" },
            provenance: { source: "team", license: "own" },
          },
        ]),
      /altText\.en/,
    ],
    [
      "media without provenance",
      (h) => (h.media = [{ id: "cover", file: "cover.png", altText: { pl: "a", en: "b" } }]),
      /provenance/,
    ],
    [
      "media path traversal",
      (h) =>
        (h.media = [
          { id: "c", file: "../secret.png", altText: { pl: "a", en: "b" }, provenance: { source: "s", license: "l" } },
        ]),
      /without traversal/,
    ],
    [
      "unsupported media type",
      (h) =>
        (h.media = [
          { id: "c", file: "clip.svg", altText: { pl: "a", en: "b" }, provenance: { source: "s", license: "l" } },
        ]),
      /without traversal/,
    ],
  ])("%s", (_name, mutate, expected) => {
    const issues = issuesFor(mutate);
    expect(issues.join("\n")).toMatch(expected);
  });

  it("never echoes answers or tokens in issue messages", () => {
    const issues = issuesFor((h) => {
      h.checkpoints[1].questions[0].accepted.en.push("COPPER");
      h.finale.qrToken = "not-a-valid-token!";
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join("\n")).not.toMatch(/COPPER|not-a-valid-token/);
  });
});

describe("content directory", () => {
  const edit = (directory: string, relative: string, mutate: (json: Json) => void) => {
    const file = join(directory, relative);
    const json = JSON.parse(readFileSync(file, "utf8"));
    mutate(json);
    writeFileSync(file, JSON.stringify(json));
  };
  const messages = (directory: string) => {
    const loaded = loadContentDirectory(directory);
    return loaded.ok ? "" : loaded.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
  };

  it("rejects a release pointing at a missing version", () => {
    const directory = copyOfSynthetic();
    edit(directory, "release.json", (r) => (r.hunts["demo-square"].currentVersion = 2));
    expect(messages(directory)).toMatch(/no file exists for this version/);
  });

  it("rejects hunts missing from the release manifest and misplaced files", () => {
    const directory = copyOfSynthetic();
    edit(directory, "release.json", (r) => delete r.hunts["clock-walk"]);
    expect(messages(directory)).toMatch(/not listed in release\.json/);
    const other = copyOfSynthetic();
    edit(other, "hunts/clock-walk/v1.json", (h) => (h.version = 2));
    expect(messages(other)).toMatch(/file path must be/);
  });

  it("rejects one QR token bound to two different hunts", () => {
    const directory = copyOfSynthetic();
    const token = fixture("demo-square").finale.qrToken;
    edit(directory, "hunts/clock-walk/v1.json", (h) => (h.finale = { type: "qr", qrToken: token }));
    expect(messages(directory)).toMatch(/already bound to hunt/);
  });

  it("requires a reason for unavailable hunts and referenced media files to exist", () => {
    const directory = copyOfSynthetic();
    edit(directory, "release.json", (r) => (r.hunts["demo-square"].available = false));
    expect(messages(directory)).toMatch(/required when unavailable/);
    const other = copyOfSynthetic();
    edit(other, "hunts/clock-walk/v1.json", (h) => {
      h.media = [
        { id: "cover", file: "cover.png", altText: { pl: "a", en: "b" }, provenance: { source: "s", license: "l" } },
      ];
      h.coverImage = "cover";
    });
    expect(messages(other)).toMatch(/does not exist under media/);
  });
});

describe("immutable versions", () => {
  const release = () => {
    const loaded = loadContentDirectory(SYNTHETIC);
    if (!loaded.ok) throw new Error("fixtures invalid");
    return loaded.release;
  };
  const registered = () =>
    release().hunts.flatMap((hunt) =>
      hunt.versions.map(({ huntId, version, digest }) => ({ huntId, version, digest })),
    );

  it("accept an unchanged release", () => {
    expect(checkImmutability(registered(), release())).toEqual([]);
  });

  it("reject modified content of a registered version", () => {
    const existing = registered().map((entry) => ({
      ...entry,
      digest: entry.huntId === "demo-square" ? "0".repeat(64) : entry.digest,
    }));
    expect(checkImmutability(existing, release())[0]?.message).toMatch(/immutable version changed/);
  });

  it("reject removal of a registered hunt", () => {
    const next = release();
    next.hunts = next.hunts.filter((hunt) => hunt.huntId !== "clock-walk");
    expect(checkImmutability(registered(), next)[0]?.message).toMatch(/registered hunt was removed/);
  });
});
