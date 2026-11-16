import type { Locale, RunSnapshot } from "@signal-hunt/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { cryptoRandom, type RandomSource } from "../src/infrastructure/adapters";
import {
  Player,
  correctAnswer,
  createTestApp,
  currentCheckpoint,
  expectError,
  fixNear,
  syntheticQrPayload,
  wrongAnswer,
  type TestApp,
} from "./harness";

let t: TestApp;
afterEach(async () => {
  await t?.close();
});

/** Always draws the first remaining pool entry and keeps authored choice order (tests only). */
const firstPick: RandomSource = { int: () => 0, token: cryptoRandom.token };

const hint = (player: Player, run: RunSnapshot, selectedId: string) =>
  player.call("POST", `/v1/runs/${run.id}/questions/${selectedId}/hint`, {
    body: { expectedRunRevision: run.revision },
  });
const reveal = (player: Player, run: RunSnapshot, selectedId: string) =>
  player.call("POST", `/v1/runs/${run.id}/questions/${selectedId}/reveal`, {
    body: { expectedRunRevision: run.revision, confirm: true },
  });

describe("strict proximity through the API", () => {
  it("unlocks within the radius and rejects outside it regardless of accuracy", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.startOk("demo-square");

    const far = await player.unlock(run, { northMeters: 40.5, accuracyMeters: 25 });
    expectError(far, "LOCATION_TOO_FAR");
    expect(far.body.params).toEqual({ radiusMeters: 40 });
    expect(JSON.stringify(far.body)).not.toMatch(/52\.\d{3,}|21\.\d{3,}/);

    expect((await player.getRun(run.id)).checkpoints[0]).toMatchObject({ state: "reachable", questions: [] });
    const near = await player.unlock(run, { northMeters: 39.5, accuracyMeters: 25 });
    expect(near.status).toBe(200);
    expect(near.body.run.checkpoints[0].state).toBe("unlocked");
  });

  it("applies an authored tighter radius", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    let run = await player.unlockOk(await player.startOk("clock-walk"));
    run = await player.answerAll(run);
    expect(currentCheckpoint(run)).toMatchObject({ id: "clock", radiusMeters: 25, state: "reachable" });
    expectError(await player.unlock(run, { northMeters: 30 }), "LOCATION_TOO_FAR");
    expect((await player.unlock(run, { northMeters: 24 })).status).toBe(200);
  });

  it("rejects inaccurate, stale and future-dated fixes with explicit causes", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.startOk("demo-square");

    const inaccurate = await player.unlock(run, { accuracyMeters: 25.5 });
    expectError(inaccurate, "LOCATION_ACCURACY_INSUFFICIENT");
    expect(inaccurate.body.params).toEqual({ maxAccuracyMeters: 25 });

    const stale = await player.unlock(run, { ageMs: 15_001 });
    expectError(stale, "LOCATION_FIX_STALE");
    expect(stale.body.params).toEqual({ maxFixAgeSeconds: 15 });

    expectError(await player.unlock(run, { ageMs: -5001 }), "LOCATION_FIX_IN_FUTURE");
    expect((await player.getRun(run.id)).revision).toBe(run.revision);

    expect((await player.unlock(run, { ageMs: 15_000, accuracyMeters: 25 })).status).toBe(200);
  });

  it("accepts a fix dated up to 5 s ahead of the server clock", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.startOk("demo-square");
    expect((await player.unlock(run, { ageMs: -5000 })).status).toBe(200);
  });

  it.each([
    ["latitude out of range", { latitude: 90.5 }],
    ["longitude out of range", { longitude: 181 }],
    ["negative accuracy", { accuracyMeters: -1 }],
    ["non-numeric accuracy", { accuracyMeters: "5" }],
    ["missing timestamp", { capturedAt: undefined }],
    ["timestamp without offset", { capturedAt: "2026-06-01T10:00:00" }],
    ["client-computed distance", { distanceMeters: 1 }],
  ])("rejects an invalid fix: %s", async (_name, override) => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.startOk("demo-square");
    const location = { ...fixNear(run.checkpoints[0]!.location, t.clock), ...override };
    const response = await player.call("POST", `/v1/runs/${run.id}/checkpoints/gate/unlock`, {
      body: { expectedRunRevision: run.revision, location },
    });
    expectError(response, "INVALID_REQUEST");
    expect((await player.getRun(run.id)).checkpoints[0]!.state).toBe("reachable");
  });

  it("offers no bypass: missing location, override flags and future checkpoints are refused", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.startOk("demo-square");
    const url = (checkpointId: string) => `/v1/runs/${run.id}/checkpoints/${checkpointId}/unlock`;
    const location = fixNear(run.checkpoints[0]!.location, t.clock);

    expectError(
      await player.call("POST", url("gate"), { body: { expectedRunRevision: run.revision } }),
      "INVALID_REQUEST",
    );
    expectError(
      await player.call("POST", url("gate"), { body: { expectedRunRevision: run.revision, location, override: true } }),
      "INVALID_REQUEST",
    );
    // A later checkpoint and a non-existent one are indistinguishable.
    const later = await player.call("POST", url("pavilion"), { body: { expectedRunRevision: run.revision, location } });
    const unknown = await player.call("POST", url("nowhere"), {
      body: { expectedRunRevision: run.revision, location },
    });
    expectError(later, "CHECKPOINT_NOT_REACHABLE");
    expectError(unknown, "CHECKPOINT_NOT_REACHABLE");
    expect({ ...later.body, correlationId: "" }).toEqual({ ...unknown.body, correlationId: "" });
  });
});

describe("question selection", () => {
  it("draws the configured number of distinct questions and never redraws", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    let run = await player.unlockOk(await player.startOk("clock-walk"));
    run = await player.answerAll(run);
    run = await player.unlockOk(run);
    const selection = currentCheckpoint(run).questions;
    expect(selection).toHaveLength(2);
    expect(new Set(selection.map((question) => question.prompt)).size).toBe(2);

    for (let i = 0; i < 3; i += 1) expect(currentCheckpoint(await player.getRun(run.id)).questions).toEqual(selection);

    // A second unlock with a new key cannot redraw.
    expectError(await player.unlock(run), "CHECKPOINT_ALREADY_UNLOCKED");
    expectError(await player.unlock({ ...run, revision: run.revision - 1 }), "RUN_REVISION_CONFLICT");
    expect(currentCheckpoint(await player.getRun(run.id)).questions).toEqual(selection);
  });

  it("persists choice order once and keeps IDs stable across locales", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.playToUnlockedFinale("demo-square");
    const choiceQuestion = currentCheckpoint(run).questions.find((question) => question.type === "choice")!;
    expect(choiceQuestion.choices!.map((choice) => choice.id).sort()).toEqual(["bird", "sun", "tree"]);

    player.locale = "pl";
    const polish = currentCheckpoint(await player.getRun(run.id));
    const polishChoice = polish.questions.find((question) => question.selectedId === choiceQuestion.selectedId)!;
    expect(polish.questions.map((question) => question.selectedId)).toEqual(
      currentCheckpoint(run).questions.map((question) => question.selectedId),
    );
    expect(polishChoice.choices!.map((choice) => choice.id)).toEqual(
      choiceQuestion.choices!.map((choice) => choice.id),
    );
    expect(polishChoice.prompt).toBe("Co przedstawia znak na pawilonie?");
    expect(polishChoice.choices!.find((choice) => choice.id === "bird")!.text).toBe("Ptak");
    expect(polish.title).toBe("Pawilon");
  });

  it("draws every pool member over many replays (no fixed selection)", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const seen = new Set<string>();
    for (let i = 0; i < 40 && seen.size < 2; i += 1) {
      const run = await player.unlockOk(await player.startOk("demo-square"));
      seen.add(currentCheckpoint(run).questions[0]!.prompt);
      await player.call("POST", `/v1/runs/${run.id}/abandon`, {
        body: { expectedRunRevision: run.revision, confirm: true },
      });
    }
    expect(seen.size).toBe(2);
  });
});

describe("answers", () => {
  it("treats a wrong answer as a normal result with unlimited attempts and no state change", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.unlockOk(await player.startOk("clock-walk"));
    const question = run.checkpoints[0]!.questions[0]!;
    for (let i = 0; i < 5; i += 1) {
      const response = await player.answer(run, question, wrongAnswer(question, run.huntId, "en"));
      expect(response.status).toBe(200);
      expect(response.body.evaluation).toEqual({ result: "incorrect" });
      expect(response.body.run).toEqual(run);
      expect(JSON.stringify(response.body)).not.toContain("1924");
    }
    const correct = await player.answer(run, question, { type: "numeric", value: " 1924,0 " });
    expect(correct.body.evaluation).toEqual({ result: "correct" });
    expect(correct.body.run.checkpoints[0].questions[0]).toMatchObject({ resolution: "correct", assistance: null });
    expect(correct.body.run.revision).toBe(run.revision + 1);
  });

  it("distinguishes malformed input and wrong type from wrong answers, without leaking the key", async () => {
    t = await createTestApp({ random: firstPick });
    const player = await Player.provision(t);
    let run = await player.unlockOk(await player.startOk("clock-walk"));
    const numeric = run.checkpoints[0]!.questions[0]!;
    for (const value of ["", "   ", "19 24", "1,924.0", "1924 r.", "MCMXXIV"]) {
      const response = await player.answer(run, numeric, { type: "numeric", value });
      expectError(response, "ANSWER_INVALID");
      expect(response.body.params).toEqual({});
    }
    expectError(await player.answer(run, numeric, { type: "text", value: "1924" }), "ANSWER_TYPE_MISMATCH");
    expectError(await player.answer(run, numeric, { type: "choice", choiceId: "star" }), "ANSWER_TYPE_MISMATCH");
    expectError(
      await player.call("POST", `/v1/runs/${run.id}/questions/${numeric.selectedId}/answer`, {
        body: { expectedRunRevision: run.revision, answer: { type: "numeric", value: "1924" }, correct: true },
      }),
      "INVALID_REQUEST",
    );

    run = await player.unlockOk(await player.answerAll(run));
    const text = currentCheckpoint(run).questions.find((question) => question.type === "text")!;
    expectError(await player.answer(run, text, { type: "text", value: " \t " }), "ANSWER_INVALID");
    expectError(await player.answer(run, text, { type: "text", value: "x".repeat(201) }), "ANSWER_INVALID");
    expect((await player.getRun(run.id)).revision).toBe(run.revision);
  });

  it("matches text with language-scoped aliases from the request locale and preserves diacritics", async () => {
    t = await createTestApp({ random: firstPick });
    const player = await Player.provision(t);
    let run = await player.unlockOk(await player.answerAll(await player.unlockOk(await player.startOk("clock-walk"))));
    const [colour, maker] = currentCheckpoint(run).questions as [any, any];
    expect([colour.prompt, maker.prompt]).toEqual([
      "What colour is the clock face?",
      "Which city was the clockmaker from?",
    ]);

    // English request: the Polish alias is not accepted.
    expect((await player.answer(run, colour, { type: "text", value: "miedziany" })).body.evaluation.result).toBe(
      "incorrect",
    );
    // Polish request: the English alias is not accepted, the Polish one is (case/whitespace-insensitive).
    player.locale = "pl";
    expect((await player.answer(run, colour, { type: "text", value: "copper" })).body.evaluation.result).toBe(
      "incorrect",
    );
    const polish = await player.answer(run, colour, { type: "text", value: "  MIEDZIANA " });
    expect(polish.body.evaluation.result).toBe("correct");
    run = polish.body.run;

    // Diacritics are significant in Polish; the English variant explicitly authors "Lodz" too.
    expect((await player.answer(run, maker, { type: "text", value: "lodz" })).body.evaluation.result).toBe("incorrect");
    player.locale = "en";
    expect((await player.answer(run, maker, { type: "text", value: "lodz" })).body.evaluation.result).toBe("correct");
  });

  it("applies authored numeric tolerance at its boundary", async () => {
    t = await createTestApp({ random: { int: (max) => max - 1, token: cryptoRandom.token } });
    const player = await Player.provision(t);
    const run = await player.unlockOk(
      await player.answerAll(await player.unlockOk(await player.startOk("clock-walk"))),
    );
    const height = currentCheckpoint(run).questions.find((question) => question.type === "numeric")!;
    expect((await player.answer(run, height, { type: "numeric", value: "3.61" })).body.evaluation.result).toBe(
      "incorrect",
    );
    expect((await player.answer(run, height, { type: "numeric", value: "3,39" })).body.evaluation.result).toBe(
      "incorrect",
    );
    expect((await player.answer(run, height, { type: "numeric", value: "3,6" })).body.evaluation.result).toBe(
      "correct",
    );
  });

  it("rejects answers to resolved questions", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.unlockOk(await player.startOk("clock-walk"));
    const question = run.checkpoints[0]!.questions[0]!;
    const resolved = (await player.answer(run, question, { type: "numeric", value: "1924" })).body.run;
    expectError(
      await player.answer(resolved, question, { type: "numeric", value: "1924" }),
      "QUESTION_ALREADY_RESOLVED",
    );
    expectError(await hint(player, resolved, question.selectedId), "QUESTION_ALREADY_RESOLVED");
    expectError(await reveal(player, resolved, question.selectedId), "QUESTION_ALREADY_RESOLVED");
  });
});

describe("hints and assistance", () => {
  it("reveals authored hints one at a time, in order, without resolving the question", async () => {
    t = await createTestApp({ random: firstPick });
    const player = await Player.provision(t);
    let run = await player.unlockOk(await player.answerAll(await player.unlockOk(await player.startOk("demo-square"))));
    const question = currentCheckpoint(run).questions[0]!;
    expect(question).toMatchObject({ type: "text", revealedHints: [], hasMoreHints: true });

    const first = await hint(player, run, question.selectedId);
    expect(first.status).toBe(200);
    expect(first.body.hint).toEqual({ position: 1, text: "Look at the surface behind the hands." });
    run = first.body.run;
    expect(currentCheckpoint(run).questions[0]).toMatchObject({
      resolution: "unresolved",
      revealedHints: ["Look at the surface behind the hands."],
      hasMoreHints: true,
    });

    const second = await hint(player, run, question.selectedId);
    expect(second.body.hint).toEqual({ position: 2, text: "It is the colour of a metal." });
    run = second.body.run;
    expect(currentCheckpoint(run).questions[0]).toMatchObject({ resolution: "unresolved", hasMoreHints: false });
    expect(run).toMatchObject({ hintsUsed: 2, assistedQuestionCount: 0, resolvedCheckpointCount: 1 });

    expectError(await hint(player, run, question.selectedId), "NO_HINTS_REMAINING");
    expect((await player.getRun(run.id)).hintsUsed).toBe(2);

    // Revealed hints follow the Settings language without being consumed again.
    player.locale = "pl";
    expect(currentCheckpoint(await player.getRun(run.id)).questions[0]!.revealedHints).toEqual([
      "Przyjrzyj się powierzchni za wskazówkami.",
      "To kolor pewnego metalu.",
    ]);
  });

  it("resolves a question as assisted only after explicit confirmation and returns the authored answer", async () => {
    t = await createTestApp({ random: firstPick });
    const player = await Player.provision(t);
    const run = await player.unlockOk(await player.startOk("demo-square"));
    const question = run.checkpoints[0]!.questions[0]!;
    const url = `/v1/runs/${run.id}/questions/${question.selectedId}/reveal`;
    expectError(await player.call("POST", url, { body: { expectedRunRevision: run.revision } }), "INVALID_REQUEST");
    expect(JSON.stringify(await player.getRun(run.id))).not.toContain("There is a star above the gate.");

    const assisted = await reveal(player, run, question.selectedId);
    expect(assisted.status).toBe(200);
    expect(assisted.body.assistance).toEqual({ answerDisplay: "Star", explanation: "There is a star above the gate." });
    const after: RunSnapshot = assisted.body.run;
    expect(after.checkpoints[0]!.questions[0]).toMatchObject({
      resolution: "assisted",
      assistance: { answerDisplay: "Star", explanation: "There is a star above the gate." },
    });
    expect(after).toMatchObject({ assistedQuestionCount: 1, hintsUsed: 0, resolvedCheckpointCount: 1 });
    // The next checkpoint is revealed for navigation only: its questions still need its own unlock.
    expect(currentCheckpoint(after)).toMatchObject({ id: "clock", state: "reachable", questions: [] });
  });

  it("cannot reveal answers before the location unlock", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.startOk("demo-square");
    expect(run.checkpoints[0]!.questions).toEqual([]);
    for (const action of ["answer", "hint", "reveal"]) {
      const response = await player.call("POST", `/v1/runs/${run.id}/questions/sq_guess/${action}`, {
        body: { expectedRunRevision: run.revision, confirm: true, answer: { type: "numeric", value: "1" } },
      });
      expect([400, 404]).toContain(response.status);
    }
    expectError(await reveal(player, run, "sq_guess"), "NOT_FOUND");
  });
});

describe("digital finale", () => {
  it.each<Locale>(["en", "pl"])("completes when every checkpoint's questions resolve (%s)", async (locale) => {
    t = await createTestApp();
    const player = await Player.provision(t);
    player.locale = locale;
    let run = await player.startOk("clock-walk");
    expect(run.huntTitle).toBe(locale === "pl" ? "Spacer zegarmistrza" : "The Clockmaker's Walk");
    for (let index = 0; index < 3; index += 1) {
      expect(run.checkpoints).toHaveLength(index + 1);
      run = await player.unlockOk(run);
      expect(run.state).toBe("active");
      run = await player.answerAll(run);
    }
    expect(run).toMatchObject({ state: "completed", resolvedCheckpointCount: 3, checkpointCount: 3 });
    expect(run.completedAt).not.toBeNull();
    expect(run.finale).toMatchObject({
      type: "digital",
      qrRequired: false,
      questionsResolved: true,
      qrValidated: false,
    });
    expect((await player.call("GET", "/v1/me")).body.activeRunId).toBeNull();

    expectError(await player.scan(run, syntheticQrPayload()), "RUN_TERMINAL");
    const journal = (await player.call("GET", "/v1/runs?group=history")).body.items;
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ id: run.id, state: "completed" });
  });

  it("does not accept QR scans for a digital hunt", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.playToUnlockedFinale("clock-walk");
    expectError(await player.scan(run, syntheticQrPayload()), "FINALE_NOT_QR");
  });
});

describe("QR finale", () => {
  it("completes with questions first, then the scan", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    let run = await player.playToUnlockedFinale("demo-square");
    run = await player.answerAll(run);
    expect(run.state).toBe("active");
    expect(run.finale).toMatchObject({ questionsResolved: true, qrValidated: false, unlocked: true });
    expect(currentCheckpoint(run).state).toBe("unlocked");

    const scanned = await player.scan(run, syntheticQrPayload());
    expect(scanned.status).toBe(200);
    expect(scanned.body.run).toMatchObject({ state: "completed", resolvedCheckpointCount: 3 });
    expect(scanned.body.run.finale).toMatchObject({ questionsResolved: true, qrValidated: true });
    expect(scanned.body.run.completedAt).not.toBeNull();
  });

  it("completes with the scan first, then the questions, exactly once", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    let run = await player.playToUnlockedFinale("demo-square");
    const scanned = await player.scan(run, syntheticQrPayload());
    expect(scanned.status).toBe(200);
    run = scanned.body.run;
    expect(run.state).toBe("active");
    expect(run.finale).toMatchObject({ questionsResolved: false, qrValidated: true });
    expect(run.finale.qrValidatedAt).not.toBeNull();

    expectError(await player.scan(run, syntheticQrPayload()), "QR_ALREADY_VALIDATED");
    const [first, second] = currentCheckpoint(run).questions as [any, any];
    const partial = await player.answer(run, first, correctAnswer("demo-square", first, "en"));
    expect(partial.body.run.state).toBe("active");
    const done = await player.answer(partial.body.run, second, correctAnswer("demo-square", second, "en"));
    expect(done.body.run.state).toBe("completed");
    expectError(await player.scan(done.body.run, syntheticQrPayload()), "RUN_TERMINAL");
  });

  it("lets assistance resolve final questions but never the scan", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    let run = await player.playToUnlockedFinale("demo-square");
    for (const question of currentCheckpoint(run).questions) {
      run = (await reveal(player, run, question.selectedId)).body.run;
    }
    expect(run).toMatchObject({ state: "active", assistedQuestionCount: 2 });
    expect(run.finale).toMatchObject({ questionsResolved: true, qrValidated: false });
    // The scan still needs its own fresh, valid fix.
    expectError(await player.scan(run, syntheticQrPayload(), { northMeters: 60 }), "LOCATION_TOO_FAR");
    expectError(await player.scan(run, syntheticQrPayload(), { ageMs: 20_000 }), "LOCATION_FIX_STALE");
    expectError(await player.scan(run, syntheticQrPayload(), { accuracyMeters: 40 }), "LOCATION_ACCURACY_INSUFFICIENT");
    expect((await player.getRun(run.id)).state).toBe("active");
    expect((await player.scan(run, syntheticQrPayload())).body.run.state).toBe("completed");
  });

  it("rejects wrong-cache tokens and anything that is not an app payload, without marking success", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.playToUnlockedFinale("demo-square");
    const token = syntheticQrPayload().split(":").pop()!;

    expectError(await player.scan(run, `signal-hunt:qr:v1:${"Z".repeat(43)}`), "QR_WRONG_CACHE");
    for (const payload of [
      `https://example.com/redirect?to=signal-hunt:qr:v1:${token}`,
      `http://127.0.0.1/${token}`,
      token,
      `signal-hunt:qr:v2:${token}`,
      `SIGNAL-HUNT:QR:V1:${token}`,
      "javascript:alert(1)",
    ]) {
      const response = await player.scan(run, payload);
      expectError(response, "QR_FORMAT_INVALID");
      expect(JSON.stringify(response.body)).not.toContain(token);
    }
    expectError(
      await player.call("POST", `/v1/runs/${run.id}/finale/scan`, {
        body: { expectedRunRevision: run.revision, payload: syntheticQrPayload(), qrValidated: true },
      }),
      "INVALID_REQUEST",
    );
    const after = await player.getRun(run.id);
    expect(after.finale.qrValidated).toBe(false);
    expect(after.revision).toBe(run.revision);
  });

  it("refuses the scan before the final checkpoint is unlocked", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    let run = await player.startOk("demo-square");
    expectError(await player.scan(run, syntheticQrPayload()), "FINALE_NOT_UNLOCKED");
    run = await player.answerAll(await player.unlockOk(run));
    run = await player.answerAll(await player.unlockOk(run));
    expect(currentCheckpoint(run)).toMatchObject({ id: "pavilion", state: "reachable", isFinale: true });
    expectError(await player.scan(run, syntheticQrPayload()), "FINALE_NOT_UNLOCKED");
    expect((await player.getRun(run.id)).finale.qrValidated).toBe(false);
  });
});
