import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPERATION_OUTCOME_SCHEMAS, OperationStatusResponseSchema, type RunSnapshot } from "@signal-hunt/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { cryptoRandom, type RandomSource } from "../src/infrastructure/adapters";
import { openDatabase } from "../src/infrastructure/db/client";
import { registerRelease } from "../src/modules/content/release";
import {
  Player,
  compileSource,
  createTestApp,
  currentCheckpoint,
  dumpDatabase,
  expectError,
  fixNear,
  syntheticQrPayload,
  syntheticRelease,
  syntheticSource,
  type TestApp,
} from "./harness";

let t: TestApp;
const temporary: string[] = [];
afterEach(async () => {
  await t?.close().catch(() => undefined);
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const firstPick: RandomSource = { int: () => 0, token: cryptoRandom.token };
const operationRows = () =>
  (t.ctx.database.sqlite.prepare("select count(*) as count from operations").get() as { count: number }).count;
const status = (player: Player, key: string) => player.call("GET", `/v1/operations/${key}`);

describe("idempotent mutations", () => {
  it("replays a start without creating another run", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const key = randomUUID();
    const body = { huntId: "clock-walk", huntVersion: 1, expectedInstallationRevision: 0 };
    const first = await player.call("POST", "/v1/runs", { body, key });
    const retry = await player.call("POST", "/v1/runs", { body, key });
    expect(first.status).toBe(201);
    expect(first.headers["idempotency-replayed"]).toBeUndefined();
    expect(retry.status).toBe(201);
    expect(retry.headers["idempotency-replayed"]).toBe("true");
    expect(retry.body).toEqual(first.body);
    expect((await player.call("GET", "/v1/runs")).body.items).toHaveLength(1);
    expect(await player.revision()).toBe(1);
  });

  it("replays an unlock after a lost response without redrawing, even once the fix is stale", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    let run = await player.unlockOk(await player.startOk("clock-walk"));
    run = await player.answerAll(run);
    const key = randomUUID();
    const body = { expectedRunRevision: run.revision, location: fixNear(currentCheckpoint(run).location, t.clock) };
    const url = `/v1/runs/${run.id}/checkpoints/clock/unlock`;

    const first = await player.call("POST", url, { body, key });
    expect(first.status).toBe(200);
    t.clock.advance(5 * 60 * 1000);
    const retry = await player.call("POST", url, { body, key });
    expect(retry.status).toBe(200);
    expect(retry.headers["idempotency-replayed"]).toBe("true");
    expect(retry.body).toEqual(first.body);
    expect(currentCheckpoint(await player.getRun(run.id)).questions).toEqual(
      currentCheckpoint(first.body.run).questions,
    );

    // A brand-new request with the same stale fix is still judged on freshness.
    const other = await player.startOk("demo-square");
    const staleFix = { ...fixNear(other.checkpoints[0]!.location, t.clock), capturedAt: body.location.capturedAt };
    expectError(
      await player.call("POST", `/v1/runs/${other.id}/checkpoints/gate/unlock`, {
        body: { expectedRunRevision: other.revision, location: staleFix },
      }),
      "LOCATION_FIX_STALE",
    );
  });

  it("does not consume another hint or advance twice on retries", async () => {
    t = await createTestApp({ random: firstPick });
    const player = await Player.provision(t);
    let run = await player.unlockOk(await player.answerAll(await player.unlockOk(await player.startOk("demo-square"))));
    const question = currentCheckpoint(run).questions[0]!;
    const hintUrl = `/v1/runs/${run.id}/questions/${question.selectedId}/hint`;
    const key = randomUUID();
    const first = await player.call("POST", hintUrl, { body: { expectedRunRevision: run.revision }, key });
    for (let i = 0; i < 3; i += 1) {
      const retry = await player.call("POST", hintUrl, { body: { expectedRunRevision: run.revision }, key });
      expect(retry.body).toEqual(first.body);
    }
    run = await player.getRun(run.id);
    expect(run.hintsUsed).toBe(1);
    expect(run.revision).toBe(first.body.run.revision);

    const answerKey = randomUUID();
    const answerBody = { expectedRunRevision: run.revision, answer: { type: "text", value: "copper" } };
    const answerUrl = `/v1/runs/${run.id}/questions/${question.selectedId}/answer`;
    const answered = await player.call("POST", answerUrl, { body: answerBody, key: answerKey });
    const answeredAgain = await player.call("POST", answerUrl, { body: answerBody, key: answerKey });
    expect(answered.body.evaluation.result).toBe("correct");
    expect(answeredAgain.body).toEqual(answered.body);
    const after = await player.getRun(run.id);
    expect(after.resolvedCheckpointCount).toBe(2);
    expect(after.checkpoints).toHaveLength(3);
  });

  it("applies concurrent duplicates once", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.unlockOk(await player.startOk("clock-walk"));
    const question = run.checkpoints[0]!.questions[0]!;
    const key = randomUUID();
    const before = operationRows();
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => player.answer(run, question, { type: "numeric", value: "1924" }, { key })),
    );
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.body).toEqual(responses[0]!.body);
    }
    expect(responses.filter((response) => response.headers["idempotency-replayed"] === "true")).toHaveLength(5);
    expect(operationRows()).toBe(before + 1);
    expect((await player.getRun(run.id)).revision).toBe(run.revision + 1);
  });

  it("rejects a reused key with a different payload instead of overwriting the accepted request", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.startOk("demo-square");
    const key = randomUUID();
    const first = await player.unlock(run, {}, { key });
    expect(first.status).toBe(200);

    // Same key, newly acquired fix.
    expectError(await player.unlock(run, { northMeters: 7 }, { key }), "IDEMPOTENCY_KEY_CONFLICT");
    // Same key, different operation.
    expectError(
      await player.call("POST", `/v1/runs/${run.id}/suspend`, { body: { expectedRunRevision: run.revision }, key }),
      "IDEMPOTENCY_KEY_CONFLICT",
    );
    // Same key and body, different captured locale: the pending request keeps its original language.
    const question = first.body.run.checkpoints[0]!.questions[0]!;
    const hintKey = randomUUID();
    const hintUrl = `/v1/runs/${run.id}/questions/${question.selectedId}/hint`;
    const hintBody = { expectedRunRevision: first.body.run.revision };
    expect((await player.call("POST", hintUrl, { body: hintBody, key: hintKey })).status).toBe(200);
    player.locale = "pl";
    expectError(await player.call("POST", hintUrl, { body: hintBody, key: hintKey }), "IDEMPOTENCY_KEY_CONFLICT");
    expect((await player.getRun(run.id)).hintsUsed).toBe(1);
    expect((await status(player, key)).body.outcome).toEqual(first.body);
  });

  it("does not record rejected requests, so the key can be retried with fresh input", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.startOk("demo-square");
    const key = randomUUID();
    expectError(await player.unlock(run, { northMeters: 80 }, { key }), "LOCATION_TOO_FAR");
    expect((await status(player, key)).body).toEqual({ status: "unknown" });
    expect((await player.unlock(run, {}, { key })).status).toBe(200);
    expect((await status(player, key)).body.status).toBe("committed");
  });

  it("scopes keys to the installation", async () => {
    t = await createTestApp();
    const [a, b] = [await Player.provision(t), await Player.provision(t)];
    const key = randomUUID();
    const first = await a.start("clock-walk", { key });
    const second = await b.start("clock-walk", { key });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers["idempotency-replayed"]).toBeUndefined();
    expect(second.body.run.id).not.toBe(first.body.run.id);
  });
});

describe("transactions", () => {
  it("rolls back every effect when a transaction fails after the domain changes were applied", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.startOk("demo-square");
    // Make the final step of the transaction (recording the outcome) fail.
    t.ctx.database.sqlite.exec("alter table operations rename to operations_broken");
    const key = randomUUID();
    expectError(await player.unlock(run, {}, { key }), "INTERNAL_ERROR");
    t.ctx.database.sqlite.exec("alter table operations_broken rename to operations");

    const count = (table: string) =>
      (t.ctx.database.sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count;
    expect(count("run_checkpoints")).toBe(0);
    expect(count("selected_questions")).toBe(0);
    expect(count("selected_choice_orders")).toBe(0);
    expect(await player.getRun(run.id)).toEqual(run);
    expect((await status(player, key)).body).toEqual({ status: "unknown" });
    expect((await player.unlock(run, {}, { key })).status).toBe(200);
  });

  it("answers lock contention with a retryable 503 after the bounded busy timeout, without partial writes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "signal-hunt-db-"));
    temporary.push(directory);
    const databasePath = join(directory, "contention.sqlite");
    t = await createTestApp({ databasePath });
    expect(t.ctx.database.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(t.ctx.database.sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(t.ctx.database.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    t.ctx.database.sqlite.pragma("busy_timeout = 50");

    const player = await Player.provision(t);
    const run = await player.startOk("demo-square");
    const writer = openDatabase(databasePath);
    writer.sqlite.exec("begin immediate");
    const key = randomUUID();
    const blocked = await player.unlock(run, {}, { key });
    expectError(blocked, "SERVICE_UNAVAILABLE");
    expect(blocked.body.retryable).toBe(true);
    // Reads keep working under WAL while another connection holds the write lock.
    expect(await player.getRun(run.id)).toEqual(run);
    writer.sqlite.exec("rollback");
    writer.close();

    const retried = await player.unlock(run, {}, { key });
    expect(retried.status).toBe(200);
    expect(retried.headers["idempotency-replayed"]).toBeUndefined();
  });
});

describe("operation status recovery", () => {
  it("returns the committed safe outcome to its owner and `unknown` otherwise", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const stranger = await Player.provision(t);
    const run = await player.startOk("demo-square");
    const key = randomUUID();
    const unlocked = await player.unlock(run, {}, { key });

    const committed = await status(player, key);
    expect(committed.status).toBe(200);
    const parsed = OperationStatusResponseSchema.parse(committed.body);
    expect(parsed).toMatchObject({ status: "committed", operation: "checkpoint.unlock", httpStatus: 200 });
    if (parsed.status !== "committed") throw new Error("expected committed");
    expect(OPERATION_OUTCOME_SCHEMAS[parsed.operation].parse(parsed.outcome)).toEqual(unlocked.body);

    expect((await status(stranger, key)).body).toEqual({ status: "unknown" });
    expect((await status(player, randomUUID())).body).toEqual({ status: "unknown" });
    expectError(await status(player, "bad key!"), "INVALID_REQUEST");
    expectError(await player.call("GET", `/v1/operations/${key}`, { auth: false }), "CREDENTIAL_INVALID");
  });

  it("survives a server restart together with selections and progress", async () => {
    const directory = mkdtempSync(join(tmpdir(), "signal-hunt-db-"));
    temporary.push(directory);
    const databasePath = join(directory, "restart.sqlite");

    t = await createTestApp({ databasePath });
    let player = await Player.provision(t);
    const key = randomUUID();
    let run = await player.startOk("demo-square");
    const unlocked = await player.unlock(run, {}, { key });
    run = unlocked.body.run;
    const hinted = await player.call(
      "POST",
      `/v1/runs/${run.id}/questions/${run.checkpoints[0]!.questions[0]!.selectedId}/hint`,
      {
        body: { expectedRunRevision: run.revision },
      },
    );
    const beforeRestart: RunSnapshot = hinted.body.run;
    const clock = t.clock;
    await t.close();

    t = await createTestApp({ databasePath, clock });
    player = new Player(t, player.credential, player.installationId);
    expect(await player.getRun(run.id)).toEqual(beforeRestart);
    expect((await status(player, key)).body).toMatchObject({ status: "committed", outcome: unlocked.body });
    expect((await player.call("GET", "/v1/me")).body.activeRunId).toBe(run.id);
    // The run continues normally after the restart.
    const resolved = await player.answerAll(beforeRestart);
    expect(resolved.resolvedCheckpointCount).toBe(1);
  });
});

describe("versions and availability", () => {
  function releaseWithClockWalkV2() {
    const release = syntheticRelease();
    const source = syntheticSource("clock-walk");
    source.version = 2;
    source.title = { pl: "Spacer zegarmistrza II", en: "The Clockmaker's Walk II" };
    for (const checkpoint of source.checkpoints) {
      for (const question of checkpoint.questions)
        question.prompt = { pl: `[v2] ${question.prompt.pl}`, en: `[v2] ${question.prompt.en}` };
    }
    const hunt = release.hunts.find((entry) => entry.huntId === "clock-walk")!;
    hunt.versions.push(compileSource(source));
    hunt.currentVersion = 2;
    return release;
  }

  function withdraw(huntId: string) {
    const release = syntheticRelease();
    const hunt = release.hunts.find((entry) => entry.huntId === huntId)!;
    hunt.available = false;
    hunt.unavailableReason = "withdrawn";
    const result = registerRelease(t.ctx.database, release, t.clock.now());
    expect(result.ok).toBe(true);
  }

  it("keeps a run pinned to its version when a new version is published", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    let run = await player.unlockOk(await player.startOk("clock-walk"));
    const selection = run.checkpoints[0]!.questions;

    expect(registerRelease(t.ctx.database, releaseWithClockWalkV2(), t.clock.now())).toMatchObject({
      ok: true,
      registeredVersions: 1,
    });

    const pinned = await player.getRun(run.id);
    expect(pinned).toMatchObject({ huntVersion: 1, huntTitle: "The Clockmaker's Walk" });
    expect(pinned.checkpoints[0]!.questions).toEqual(selection);
    run = await player.answerAll(pinned);
    run = await player.unlockOk(run);
    expect(currentCheckpoint(run).questions.every((question) => !question.prompt.startsWith("[v2]"))).toBe(true);

    const detail = (await player.call("GET", "/v1/hunts/clock-walk")).body;
    expect(detail).toMatchObject({ version: 2, title: "The Clockmaker's Walk II" });
    const superseded = await player.start("clock-walk", {}, 1);
    expectError(superseded, "HUNT_VERSION_SUPERSEDED");
    expect(superseded.body.params).toEqual({ currentVersion: 2 });

    const fresh = await player.start("clock-walk", {}, 2);
    expect(fresh.status).toBe(201);
    const freshRun = await player.unlockOk(fresh.body.run);
    expect(freshRun.huntVersion).toBe(2);
    expect(freshRun.checkpoints[0]!.questions[0]!.prompt.startsWith("[v2]")).toBe(true);
  });

  it("rejects modification of a registered version and removal of a hunt, changing nothing", async () => {
    t = await createTestApp();
    const before = dumpDatabase(t.ctx);

    const modified = syntheticRelease();
    const source = syntheticSource("clock-walk");
    source.checkpoints[0]!.questions[0]!.prompt.en = "A silently edited prompt?";
    modified.hunts.find((hunt) => hunt.huntId === "clock-walk")!.versions = [compileSource(source)];
    const rejected = registerRelease(t.ctx.database, modified, t.clock.now());
    expect(rejected.ok).toBe(false);

    const removed = syntheticRelease();
    removed.hunts = removed.hunts.filter((hunt) => hunt.huntId !== "demo-square");
    expect(registerRelease(t.ctx.database, removed, t.clock.now()).ok).toBe(false);

    expect(dumpDatabase(t.ctx)).toBe(before);
    expect(registerRelease(t.ctx.database, syntheticRelease(), t.clock.now())).toMatchObject({
      ok: true,
      registeredVersions: 0,
    });
  });

  it("blocks progression on a withdrawn hunt but keeps history, suspend, abandon and delete", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const suspendedRun = await player.unlockOk(await player.startOk("demo-square"));
    const active = await player.unlockOk(await player.startOk("demo-square"));
    const question = active.checkpoints[0]!.questions[0]!;
    const acceptedKey = randomUUID();
    const accepted = await player.call("POST", `/v1/runs/${active.id}/questions/${question.selectedId}/hint`, {
      body: { expectedRunRevision: active.revision },
      key: acceptedKey,
    });
    const run: RunSnapshot = accepted.body.run;

    withdraw("demo-square");

    // Discovery and new runs.
    const catalog = (await player.call("GET", "/v1/hunts")).body.items.map((item: { id: string }) => item.id);
    expect(catalog).toEqual(["clock-walk"]);
    const detail = await player.call("GET", "/v1/hunts/demo-square");
    expect(detail.status).toBe(200);
    expect(detail.body.availability).toEqual({ available: false, reasonCode: "withdrawn" });
    const blockedStart = await player.start("demo-square");
    expectError(blockedStart, "HUNT_UNAVAILABLE");
    expect(blockedStart.body.params).toEqual({ reasonCode: "withdrawn" });

    // Every progression mutation is blocked without effects.
    const revision = { expectedRunRevision: run.revision };
    const base = `/v1/runs/${run.id}`;
    expectError(await player.answer(run, question, { type: "numeric", value: "1924" }), "HUNT_UNAVAILABLE");
    expectError(
      await player.call("POST", `${base}/questions/${question.selectedId}/hint`, { body: revision }),
      "HUNT_UNAVAILABLE",
    );
    expectError(
      await player.call("POST", `${base}/questions/${question.selectedId}/reveal`, {
        body: { ...revision, confirm: true },
      }),
      "HUNT_UNAVAILABLE",
    );
    expectError(await player.scan(run, syntheticQrPayload()), "HUNT_UNAVAILABLE");
    expectError(
      await player.call("POST", `/v1/runs/${suspendedRun.id}/resume`, {
        body: { expectedRunRevision: suspendedRun.revision + 1, expectedInstallationRevision: await player.revision() },
      }),
      "HUNT_UNAVAILABLE",
    );

    // An already accepted operation still returns its historical outcome without repeating effects.
    const replay = await player.call("POST", `${base}/questions/${question.selectedId}/hint`, {
      body: { expectedRunRevision: active.revision },
      key: acceptedKey,
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(accepted.body);

    // History and lifecycle housekeeping remain available.
    const view = await player.getRun(run.id);
    expect(view).toMatchObject({
      revision: run.revision,
      hintsUsed: 1,
      availability: { available: false, reasonCode: "withdrawn" },
    });
    expect((await player.call("GET", "/v1/runs")).body.items).toHaveLength(2);
    const suspended = await player.call("POST", `${base}/suspend`, { body: revision });
    expect(suspended.status).toBe(200);
    const abandoned = await player.call("POST", `${base}/abandon`, {
      body: { expectedRunRevision: suspended.body.run.revision, confirm: true },
    });
    expect(abandoned.status).toBe(200);
    const receipt = (await player.call("POST", "/v1/me/deletion-receipt", { key: null })).body;
    expect(
      (await player.call("DELETE", "/v1/me", { headers: { "x-deletion-receipt-id": receipt.receiptId } })).status,
    ).toBe(200);
  });

  it("blocks unlock on a withdrawn hunt and restores play when it becomes available again", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.startOk("demo-square");
    withdraw("demo-square");
    expectError(await player.unlock(run), "HUNT_UNAVAILABLE");
    expect((await player.getRun(run.id)).checkpoints[0]!.state).toBe("reachable");
    expect(registerRelease(t.ctx.database, syntheticRelease(), t.clock.now()).ok).toBe(true);
    expect((await player.unlock(run)).status).toBe(200);
  });
});
