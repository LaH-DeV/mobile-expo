import { parseDecimalInput } from "@signal-hunt/contracts";
import { describe, expect, it } from "vitest";
import { cryptoRandom, wgs84Distance } from "../src/infrastructure/adapters";
import { checkProximity, drawWithoutReplacement, shuffle, type Fix } from "../src/modules/checkpoints/domain";
import { extractScanToken, isBoundToken } from "../src/modules/finales/domain";
import { decimalMatches, evaluateAnswer, type AnswerKey } from "../src/modules/questions/domain";
import { decideProgress, transitionError } from "../src/modules/runs/domain";

describe("strict proximity", () => {
  const now = 1_800_000_000_000;
  const target = { latitude: 52.23, longitude: 21.01, radiusMeters: 40 };
  const fix = (override: Partial<Fix> = {}): Fix => ({
    latitude: 52.23,
    longitude: 21.01,
    accuracyMeters: 10,
    capturedAtMs: now - 1000,
    ...override,
  });
  const at = (meters: number) => () => meters;

  it("accepts distance below and exactly at the radius, rejects above", () => {
    expect(checkProximity(fix(), target, now, at(39.999))).toBeNull();
    expect(checkProximity(fix(), target, now, at(40))).toBeNull();
    expect(checkProximity(fix(), target, now, at(40.001))).toBe("LOCATION_TOO_FAR");
  });

  it("accepts accuracy exactly 25 m and rejects above", () => {
    expect(checkProximity(fix({ accuracyMeters: 25 }), target, now, at(0))).toBeNull();
    expect(checkProximity(fix({ accuracyMeters: 25.01 }), target, now, at(0))).toBe("LOCATION_ACCURACY_INSUFFICIENT");
  });

  it("never lets accuracy extend the radius", () => {
    expect(checkProximity(fix({ accuracyMeters: 25 }), target, now, at(41))).toBe("LOCATION_TOO_FAR");
    expect(checkProximity(fix({ accuracyMeters: 0 }), target, now, at(41))).toBe("LOCATION_TOO_FAR");
  });

  it("accepts a fix exactly 15 s old and rejects older", () => {
    expect(checkProximity(fix({ capturedAtMs: now - 15_000 }), target, now, at(0))).toBeNull();
    expect(checkProximity(fix({ capturedAtMs: now - 15_001 }), target, now, at(0))).toBe("LOCATION_FIX_STALE");
  });

  it("accepts a timestamp up to 5 s in the future and rejects beyond", () => {
    expect(checkProximity(fix({ capturedAtMs: now + 5000 }), target, now, at(0))).toBeNull();
    expect(checkProximity(fix({ capturedAtMs: now + 5001 }), target, now, at(0))).toBe("LOCATION_FIX_IN_FUTURE");
  });

  it("uses the configured radius of the checkpoint", () => {
    expect(checkProximity(fix(), { ...target, radiusMeters: 15 }, now, at(15.5))).toBe("LOCATION_TOO_FAR");
    expect(checkProximity(fix(), { ...target, radiusMeters: 150 }, now, at(150))).toBeNull();
  });

  it.each([
    { latitude: Number.NaN },
    { latitude: 91 },
    { longitude: 181 },
    { accuracyMeters: -1 },
    { accuracyMeters: Infinity },
    { capturedAtMs: Number.NaN },
  ])("throws on invalid fix %j instead of passing it", (override) => {
    expect(() => checkProximity(fix(override), target, now, at(0))).toThrow(RangeError);
  });

  it("measures WGS84 distance with known reference vectors", () => {
    // One degree of longitude on the equator and one degree of latitude from 52°N (GeographicLib values).
    expect(wgs84Distance({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(111319.491, 2);
    expect(wgs84Distance({ latitude: 52, longitude: 21 }, { latitude: 53, longitude: 21 })).toBeCloseTo(111276.826, 2);
    expect(wgs84Distance({ latitude: 52.23, longitude: 21.01 }, { latitude: 52.23, longitude: 21.01 })).toBe(0);
  });
});

describe("question draw", () => {
  const pool = ["a", "b", "c", "d", "e"];

  it("returns distinct members of the pool with the requested size", () => {
    for (let i = 0; i < 200; i += 1) {
      const drawn = drawWithoutReplacement(pool, 3, cryptoRandom.int);
      expect(drawn).toHaveLength(3);
      expect(new Set(drawn).size).toBe(3);
      for (const item of drawn) expect(pool).toContain(item);
    }
    expect(pool).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("rejects impossible draw counts", () => {
    for (const count of [0, 6, -1, 1.5]) {
      expect(() => drawWithoutReplacement(pool, count, cryptoRandom.int)).toThrow(RangeError);
    }
  });

  it("is uniform: enumerating every random outcome yields each ordered selection equally often", () => {
    // Exhaustively enumerate the random choices for drawing 2 of 4: 4 * 3 equally likely paths.
    const counts = new Map<string, number>();
    for (let first = 0; first < 4; first += 1) {
      for (let second = 0; second < 3; second += 1) {
        const script = [first, second];
        const key = drawWithoutReplacement(["a", "b", "c", "d"], 2, () => script.shift() as number).join("");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(12);
    expect([...counts.values()].every((count) => count === 1)).toBe(true);
  });

  it("requests random integers only within the remaining range", () => {
    const bounds: number[] = [];
    drawWithoutReplacement(pool, 3, (max) => {
      bounds.push(max);
      return 0;
    });
    expect(bounds).toEqual([5, 4, 3]);
  });

  it("shuffles to a permutation", () => {
    expect([...shuffle(pool, cryptoRandom.int)].sort()).toEqual(pool);
    expect(shuffle([], cryptoRandom.int)).toEqual([]);
  });
});

describe("answer evaluation", () => {
  const text: AnswerKey = { type: "text", accepted: { pl: ["miedziany", "Łódź"], en: ["copper"] } };
  const exact: AnswerKey = { type: "numeric", answer: { value: "0.3" } };
  const tolerant: AnswerKey = { type: "numeric", answer: { value: "3.5", tolerance: "0.1" } };
  const choice: AnswerKey = {
    type: "choice",
    choices: [
      { id: "star", correct: true },
      { id: "leaf", correct: false },
    ],
  };

  it("matches text against the aliases of the request locale only", () => {
    expect(evaluateAnswer(text, { type: "text", value: "  MIEDZIANY " }, "pl")).toEqual({ ok: true, correct: true });
    expect(evaluateAnswer(text, { type: "text", value: "copper" }, "pl")).toEqual({ ok: true, correct: false });
    expect(evaluateAnswer(text, { type: "text", value: "Copper" }, "en")).toEqual({ ok: true, correct: true });
    expect(evaluateAnswer(text, { type: "text", value: "miedziany" }, "en")).toEqual({ ok: true, correct: false });
  });

  it("does not strip diacritics when matching", () => {
    expect(evaluateAnswer(text, { type: "text", value: "łódź" }, "pl")).toEqual({ ok: true, correct: true });
    expect(evaluateAnswer(text, { type: "text", value: "lodz" }, "pl")).toEqual({ ok: true, correct: false });
  });

  it("treats blank and overlong text as invalid input, not as a wrong answer", () => {
    expect(evaluateAnswer(text, { type: "text", value: "   " }, "pl")).toEqual({ ok: false, error: "ANSWER_INVALID" });
    expect(evaluateAnswer(text, { type: "text", value: "x".repeat(201) }, "pl")).toEqual({
      ok: false,
      error: "ANSWER_INVALID",
    });
  });

  it("compares decimals exactly where binary floating point would fail", () => {
    expect(0.1 + 0.2 === 0.3).toBe(false);
    const d = (value: string) => parseDecimalInput(value)!;
    expect(decimalMatches(d("0.30"), d("0.3"), null)).toBe(true);
    expect(decimalMatches(d("0.30000000000000004"), d("0.3"), null)).toBe(false);
    expect(decimalMatches(d("9007199254740993"), d("9007199254740992"), null)).toBe(false);
    expect(evaluateAnswer(exact, { type: "numeric", value: "0,3" }, "pl")).toEqual({ ok: true, correct: true });
    expect(evaluateAnswer(exact, { type: "numeric", value: "0.31" }, "en")).toEqual({ ok: true, correct: false });
  });

  it("applies only the authored absolute tolerance, inclusively", () => {
    const answer = (value: string) => evaluateAnswer(tolerant, { type: "numeric", value }, "en");
    expect(answer("3.4")).toEqual({ ok: true, correct: true });
    expect(answer("3,6")).toEqual({ ok: true, correct: true });
    expect(answer("3.39999")).toEqual({ ok: true, correct: false });
    expect(answer("3.60001")).toEqual({ ok: true, correct: false });
    expect(answer("-3.5")).toEqual({ ok: true, correct: false });
  });

  it.each(["", "3 m", "1 000", "1,000.5", "abc", "1e2"])("rejects malformed numeric input %j", (value) => {
    expect(evaluateAnswer(exact, { type: "numeric", value }, "en")).toEqual({ ok: false, error: "ANSWER_INVALID" });
  });

  it("evaluates a single choice by stable ID", () => {
    expect(evaluateAnswer(choice, { type: "choice", choiceId: "star" }, "en")).toEqual({ ok: true, correct: true });
    expect(evaluateAnswer(choice, { type: "choice", choiceId: "leaf" }, "pl")).toEqual({ ok: true, correct: false });
    expect(evaluateAnswer(choice, { type: "choice", choiceId: "key" }, "pl")).toEqual({
      ok: false,
      error: "ANSWER_INVALID",
    });
  });

  it("rejects an answer of the wrong type", () => {
    expect(evaluateAnswer(choice, { type: "text", value: "star" }, "en")).toEqual({
      ok: false,
      error: "ANSWER_TYPE_MISMATCH",
    });
    expect(evaluateAnswer(text, { type: "numeric", value: "1" }, "en")).toEqual({
      ok: false,
      error: "ANSWER_TYPE_MISMATCH",
    });
  });
});

describe("run state machine", () => {
  it("allows gameplay and suspension only for active runs", () => {
    expect(transitionError("active", "gameplay")).toBeNull();
    expect(transitionError("suspended", "gameplay")).toBe("RUN_NOT_ACTIVE");
    expect(transitionError("active", "suspend")).toBeNull();
    expect(transitionError("suspended", "suspend")).toBe("RUN_NOT_ACTIVE");
  });

  it("resumes only suspended runs and abandons active or suspended ones", () => {
    expect(transitionError("suspended", "resume")).toBeNull();
    expect(transitionError("active", "resume")).toBe("RUN_NOT_SUSPENDED");
    expect(transitionError("active", "abandon")).toBeNull();
    expect(transitionError("suspended", "abandon")).toBeNull();
  });

  it("keeps terminal runs terminal for every action", () => {
    for (const state of ["completed", "abandoned"] as const) {
      for (const action of ["gameplay", "resume", "suspend", "abandon"] as const) {
        expect(transitionError(state, action)).toBe("RUN_TERMINAL");
      }
    }
  });
});

describe("completion conjunction", () => {
  const base = { questionsResolved: true, isFinalCheckpoint: true, qrRequired: true, qrValidated: true };

  it("advances a resolved non-final checkpoint and stays while questions are open", () => {
    expect(decideProgress({ ...base, isFinalCheckpoint: false, qrValidated: false })).toBe("advance");
    expect(decideProgress({ ...base, questionsResolved: false, isFinalCheckpoint: false })).toBe("stay");
  });

  it("completes a digital finale on questions alone", () => {
    expect(decideProgress({ ...base, qrRequired: false, qrValidated: false })).toBe("complete");
  });

  it("requires both facts for a QR finale", () => {
    expect(decideProgress({ ...base, qrValidated: false })).toBe("stay");
    expect(decideProgress({ ...base, questionsResolved: false })).toBe("stay");
    expect(decideProgress(base)).toBe("complete");
  });
});

describe("QR scan check", () => {
  const hash = (token: string) => `h(${token})`;
  const equal = (a: string, b: string) => a === b;
  const token = "T".repeat(43);

  it("extracts tokens only from the app grammar", () => {
    expect(extractScanToken(`signal-hunt:qr:v1:${token}`)).toBe(token);
    expect(extractScanToken(`https://evil.example/?c=${token}`)).toBeNull();
    expect(extractScanToken(token)).toBeNull();
  });

  it("binds a token to the expected verifier", () => {
    expect(isBoundToken(token, hash(token), hash, equal)).toBe(true);
    expect(isBoundToken("U".repeat(43), hash(token), hash, equal)).toBe(false);
  });
});
