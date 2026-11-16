import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ERRORS,
  LocationFixSchema,
  ROUTES,
  StartRunRequestSchema,
  formatQrPayload,
  normalizeAnswerText,
  parseAcceptLanguage,
  parseDecimalInput,
  parseQrPayload,
} from "../src/index";

describe("text normalization", () => {
  it("trims, collapses whitespace and case-folds", () => {
    expect(normalizeAnswerText("  Miedziany \t\n  ZEGAR  ")).toBe("miedziany zegar");
    expect(normalizeAnswerText(" Copper Clock")).toBe("copper clock");
  });

  it("preserves Polish diacritics instead of stripping them", () => {
    expect(normalizeAnswerText("ŁÓDŹ")).toBe("łódź");
    expect(normalizeAnswerText("Łódź")).not.toBe(normalizeAnswerText("Lodz"));
    expect(normalizeAnswerText("ZAŻÓŁĆ GĘŚLĄ JAŹŃ")).toBe("zażółć gęślą jaźń");
  });

  it("treats composed and decomposed forms as equal (NFC)", () => {
    expect(normalizeAnswerText("ó")).toBe(normalizeAnswerText("ó"));
    expect(normalizeAnswerText("Ż")).toBe("ż");
  });

  it("preserves punctuation and does not apply compatibility folding", () => {
    expect(normalizeAnswerText("Co-op, św. Jan!")).toBe("co-op, św. jan!");
    expect(normalizeAnswerText("…")).toBe("…");
    expect(normalizeAnswerText("ｆｕｌｌ")).not.toBe("full");
  });

  it("folds case-mapping edge cases deterministically", () => {
    expect(normalizeAnswerText("STRASSE")).toBe(normalizeAnswerText("straße"));
    expect(normalizeAnswerText("ΌΣΟΣ")).toBe(normalizeAnswerText("όσος"));
  });

  it("yields an empty string for blank input", () => {
    expect(normalizeAnswerText(" \t\n ")).toBe("");
  });
});

describe("decimal input", () => {
  it("accepts dot or comma separators and normalizes zeros", () => {
    expect(parseDecimalInput("3.50")).toEqual({ negative: false, integer: "3", fraction: "5" });
    expect(parseDecimalInput(" 3,5 ")).toEqual({ negative: false, integer: "3", fraction: "5" });
    expect(parseDecimalInput("007")).toEqual({ negative: false, integer: "7", fraction: "" });
    expect(parseDecimalInput("-0,0")).toEqual({ negative: false, integer: "0", fraction: "" });
    expect(parseDecimalInput("-12.25")).toEqual({ negative: true, integer: "12", fraction: "25" });
  });

  it.each([
    "",
    " ",
    "1 000",
    "1,000.5",
    "1.000,5",
    "12m",
    "12 m",
    "1e3",
    "+5",
    ".5",
    "5.",
    "5,",
    "--5",
    "NaN",
    "Infinity",
    "0x10",
    "1/2",
    "٣",
  ])("rejects %j", (input) => {
    expect(parseDecimalInput(input)).toBeNull();
  });

  it("rejects overlong input", () => {
    expect(parseDecimalInput("1".repeat(41))).toBeNull();
  });
});

describe("QR payload grammar", () => {
  const token = "A".repeat(43);

  it("round-trips a versioned app-specific payload", () => {
    expect(parseQrPayload(formatQrPayload(token))).toEqual({ version: 1, token });
  });

  it.each([
    "https://example.com/signal-hunt:qr:v1:" + token,
    "signal-hunt:qr:v2:" + token,
    "signal-hunt:qr:v1:short",
    "signal-hunt:qr:v1:" + token + "?x=1",
    " signal-hunt:qr:v1:" + token,
    token,
    "javascript:alert(1)",
  ])("rejects %j", (payload) => {
    expect(parseQrPayload(payload)).toBeNull();
  });
});

describe("locale negotiation", () => {
  it("accepts only the exact supported tags", () => {
    expect(parseAcceptLanguage("pl")).toBe("pl");
    expect(parseAcceptLanguage(" EN ")).toBe("en");
    for (const value of [undefined, null, "", "de", "en-US", "pl,en;q=0.8", "*"]) {
      expect(parseAcceptLanguage(value)).toBeNull();
    }
  });
});

describe("request schemas", () => {
  it("reject client-supplied authority fields", () => {
    expect(
      StartRunRequestSchema.safeParse({ huntId: "demo", huntVersion: 1, expectedInstallationRevision: 0, runId: "x" })
        .success,
    ).toBe(false);
    const fix = { latitude: 52, longitude: 21, accuracyMeters: 5, capturedAt: "2026-06-01T10:00:00Z" };
    expect(LocationFixSchema.safeParse(fix).success).toBe(true);
    expect(LocationFixSchema.safeParse({ ...fix, distanceMeters: 1 }).success).toBe(false);
  });

  it.each([
    { latitude: 91 },
    { latitude: Number.NaN },
    { longitude: -181 },
    { accuracyMeters: -1 },
    { accuracyMeters: Number.POSITIVE_INFINITY },
    { capturedAt: "yesterday" },
    { capturedAt: "2026-06-01T10:00:00" },
  ])("reject invalid fix %j", (override) => {
    const fix = { latitude: 52, longitude: 21, accuracyMeters: 5, capturedAt: "2026-06-01T10:00:00Z" };
    expect(LocationFixSchema.safeParse({ ...fix, ...override }).success).toBe(false);
  });
});

describe("contract hygiene", () => {
  it("uses unique, language-independent message keys", () => {
    const keys = Object.values(ERRORS).map((definition) => definition.messageKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z]+(\.[a-zA-Z]+)+$/);
  });

  it("marks every mutation except provisioning and deletion as an idempotent operation", () => {
    for (const [name, route] of Object.entries(ROUTES)) {
      const exempt = ["provisionInstallation", "createDeletionReceipt", "deleteMe"].includes(name);
      if (route.method !== "GET" && !exempt) expect(route, name).toHaveProperty("operation");
    }
  });

  it("imports nothing but zod and its own files (runtime-neutral)", () => {
    const directory = join(import.meta.dirname, "../src");
    for (const file of readdirSync(directory)) {
      const source = readFileSync(join(directory, file), "utf8");
      for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
        expect(match[1] === "zod" || match[1]?.startsWith("./"), `${file} imports ${match[1]}`).toBe(true);
      }
      expect(source, file).not.toMatch(/\b(process|Buffer|require|__dirname|window|document)\b\s*[.(]/);
    }
  });
});
