import { LIMITS, RunMutationResponseSchema, RunSnapshotSchema } from "@signal-hunt/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { Player, createTestApp, currentCheckpoint, dumpDatabase, expectError, type TestApp } from "./harness";

let t: TestApp;
afterEach(async () => {
  await t?.close();
});

const activeRunCount = (installationId: string) =>
  (
    t.ctx.database.sqlite
      .prepare("select count(*) as count from runs where installation_id = ? and state = 'active'")
      .get(installationId) as { count: number }
  ).count;

describe("starting runs", () => {
  it("creates a server-identified active run exposing only the start checkpoint", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const response = await player.start("demo-square");
    expect(response.status).toBe(201);
    const body = RunMutationResponseSchema.parse(response.body);
    expect(body.installationRevision).toBe(1);
    expect(body.affectedRuns).toEqual([]);
    expect(body.run).toMatchObject({
      state: "active",
      revision: 1,
      huntId: "demo-square",
      huntVersion: 1,
      huntTitle: "The Square's Secret",
      checkpointCount: 3,
      resolvedCheckpointCount: 0,
    });
    expect(body.run.id).toMatch(/^run_/);
    expect(body.run.checkpoints).toHaveLength(1);
    expect(body.run.checkpoints[0]).toMatchObject({
      id: "gate",
      order: 1,
      state: "reachable",
      questions: [],
      radiusMeters: 40,
    });
    expect(body.run.finale).toMatchObject({ type: "qr", unlocked: false, qrRequired: true, qrValidated: false });
    expect((await player.call("GET", "/v1/me")).body).toMatchObject({
      installationRevision: 1,
      activeRunId: body.run.id,
    });
  });

  it("rejects unknown hunts, superseded or unknown versions and stale lifecycle revisions without side effects", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const start = (body: object) => player.call("POST", "/v1/runs", { body });
    expectError(await start({ huntId: "missing", huntVersion: 1, expectedInstallationRevision: 0 }), "NOT_FOUND");
    expectError(await start({ huntId: "clock-walk", huntVersion: 9, expectedInstallationRevision: 0 }), "NOT_FOUND");
    expectError(
      await start({ huntId: "clock-walk", huntVersion: 1, expectedInstallationRevision: 5 }),
      "INSTALLATION_REVISION_CONFLICT",
    );
    expect((await player.call("GET", "/v1/runs")).body.items).toEqual([]);
    expect(await player.revision()).toBe(0);
  });

  it("requires a supported locale for run requests instead of falling back", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const body = { huntId: "clock-walk", huntVersion: 1, expectedInstallationRevision: 0 };
    expectError(await player.call("POST", "/v1/runs", { body, locale: null }), "LOCALE_UNSUPPORTED");
    expectError(
      await player.call("POST", "/v1/runs", { body, headers: { "accept-language": "de" } }),
      "LOCALE_UNSUPPORTED",
    );
    expectError(
      await player.call("POST", "/v1/runs", { body, headers: { "accept-language": "pl,en;q=0.5" } }),
      "LOCALE_UNSUPPORTED",
    );
    expect(await player.revision()).toBe(0);
  });
});

describe("one active run", () => {
  it("atomically suspends the previous active run when another starts", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const first = await player.startOk("demo-square");
    const response = await player.start("clock-walk");
    expect(response.status).toBe(201);
    expect(response.body.affectedRuns).toEqual([{ id: first.id, state: "suspended", revision: first.revision + 1 }]);
    expect(response.body.installationRevision).toBe(2);
    expect((await player.getRun(first.id)).state).toBe("suspended");
    expect(activeRunCount(player.installationId)).toBe(1);
  });

  it("lets only one of two racing starts win", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const body = { huntId: "clock-walk", huntVersion: 1, expectedInstallationRevision: 0 };
    const responses = await Promise.all([
      player.call("POST", "/v1/runs", { body }),
      player.call("POST", "/v1/runs", { body: { ...body, huntId: "demo-square" } }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expectError(
      responses.find((response) => response.status === 409)!,
      "INSTALLATION_REVISION_CONFLICT",
    );
    expect(activeRunCount(player.installationId)).toBe(1);
    expect((await player.call("GET", "/v1/runs")).body.items).toHaveLength(1);
  });

  it("lets only one of two racing resumes win", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const a = await player.startOk("demo-square");
    const b = await player.startOk("clock-walk");
    const c = await player.startOk("clock-walk");
    const revision = await player.revision();
    const resume = (runId: string, runRevision: number) =>
      player.call("POST", `/v1/runs/${runId}/resume`, {
        body: { expectedRunRevision: runRevision, expectedInstallationRevision: revision },
      });
    const responses = await Promise.all([resume(a.id, a.revision + 1), resume(b.id, b.revision + 1)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(activeRunCount(player.installationId)).toBe(1);
    expect((await player.getRun(c.id)).state).toBe("suspended");
  });

  it("is enforced by the database even if application checks were bypassed", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    await player.startOk("clock-walk");
    const insert = t.ctx.database.sqlite.prepare(
      "insert into runs (id, installation_id, hunt_id, hunt_version, state, revision, started_at, updated_at) values (?, ?, 'clock-walk', 1, ?, 1, 0, 0)",
    );
    expect(() => insert.run("run_second_active", player.installationId, "active")).toThrow(/UNIQUE constraint failed/);
    expect(() => insert.run("run_bad_state", player.installationId, "paused")).toThrow(/CHECK constraint failed/);
    expect(() => insert.run("run_orphan", "ins_missing", "suspended")).toThrow(/FOREIGN KEY constraint failed/);
    insert.run("run_suspended_ok", player.installationId, "suspended");
  });

  it("rejects a start that would exceed the suspended-run limit before changing anything", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    let last = await player.startOk("clock-walk");
    for (let i = 0; i < LIMITS.suspendedRunsPerInstallation; i += 1) last = await player.startOk("clock-walk");
    const revision = await player.revision();
    const rejected = await player.start("clock-walk");
    expectError(rejected, "SUSPENDED_RUN_LIMIT");
    expect(rejected.body.params).toEqual({ limit: 20 });
    expect(await player.revision()).toBe(revision);
    expect(await player.getRun(last.id)).toMatchObject({ state: "active", revision: last.revision });
    // Managing existing runs frees capacity; nothing was silently abandoned.
    const abandon = await player.call("POST", `/v1/runs/${last.id}/abandon`, {
      body: { expectedRunRevision: last.revision, confirm: true },
    });
    expect(abandon.status).toBe(200);
    expect((await player.start("clock-walk")).status).toBe(201);
  });
});

describe("suspend, resume, abandon, replay", () => {
  it("preserves selections, hints, answers and choice order across suspend and resume", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    let run = await player.unlockOk(await player.startOk("demo-square"));
    const question = currentCheckpoint(run).questions[0]!;
    const hinted = await player.call("POST", `/v1/runs/${run.id}/questions/${question.selectedId}/hint`, {
      body: { expectedRunRevision: run.revision },
    });
    run = hinted.body.run;
    const before = currentCheckpoint(run);

    const suspended = await player.call("POST", `/v1/runs/${run.id}/suspend`, {
      body: { expectedRunRevision: run.revision },
    });
    expect(suspended.status).toBe(200);
    expect(suspended.body.run.state).toBe("suspended");
    const other = await player.startOk("clock-walk");

    const resumed = await player.call("POST", `/v1/runs/${run.id}/resume`, {
      body: { expectedRunRevision: suspended.body.run.revision, expectedInstallationRevision: await player.revision() },
    });
    expect(resumed.status).toBe(200);
    expect(resumed.body.run.state).toBe("active");
    expect(resumed.body.affectedRuns).toEqual([{ id: other.id, state: "suspended", revision: other.revision + 1 }]);
    expect(currentCheckpoint(resumed.body.run)).toEqual(before);
    expect(resumed.body.run.hintsUsed).toBe(1);
  });

  it("blocks gameplay on a suspended run and resume of an active one", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.startOk("clock-walk");
    expectError(
      await player.call("POST", `/v1/runs/${run.id}/resume`, {
        body: { expectedRunRevision: run.revision, expectedInstallationRevision: 1 },
      }),
      "RUN_NOT_SUSPENDED",
    );
    const suspended = (
      await player.call("POST", `/v1/runs/${run.id}/suspend`, { body: { expectedRunRevision: run.revision } })
    ).body.run;
    expectError(await player.unlock(suspended), "RUN_NOT_ACTIVE");
    expectError(
      await player.call("POST", `/v1/runs/${run.id}/suspend`, { body: { expectedRunRevision: suspended.revision } }),
      "RUN_NOT_ACTIVE",
    );
  });

  it("requires explicit confirmation to abandon and makes abandonment terminal", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.unlockOk(await player.startOk("clock-walk"));
    const url = `/v1/runs/${run.id}/abandon`;
    expectError(await player.call("POST", url, { body: { expectedRunRevision: run.revision } }), "INVALID_REQUEST");
    expectError(
      await player.call("POST", url, { body: { expectedRunRevision: run.revision, confirm: false } }),
      "INVALID_REQUEST",
    );
    expect((await player.getRun(run.id)).state).toBe("active");

    const abandoned = await player.call("POST", url, { body: { expectedRunRevision: run.revision, confirm: true } });
    expect(abandoned.status).toBe(200);
    expect(abandoned.body.run).toMatchObject({ state: "abandoned" });
    expect(abandoned.body.run.abandonedAt).not.toBeNull();
    const terminal = abandoned.body.run;

    const question = terminal.checkpoints[0].questions[0];
    const revision = { expectedRunRevision: terminal.revision };
    expectError(
      await player.call("POST", `/v1/runs/${run.id}/resume`, {
        body: { ...revision, expectedInstallationRevision: await player.revision() },
      }),
      "RUN_TERMINAL",
    );
    expectError(await player.call("POST", `/v1/runs/${run.id}/suspend`, { body: revision }), "RUN_TERMINAL");
    expectError(await player.call("POST", url, { body: { ...revision, confirm: true } }), "RUN_TERMINAL");
    expectError(await player.answer(terminal, question, { type: "numeric", value: "1924" }), "RUN_TERMINAL");
    expectError(
      await player.call("POST", `/v1/runs/${run.id}/questions/${question.selectedId}/hint`, { body: revision }),
      "RUN_TERMINAL",
    );
    // A delayed request carrying the pre-abandon revision cannot rewrite the terminal run either.
    expectError(await player.answer(run, question, { type: "numeric", value: "1924" }), "RUN_TERMINAL");
    expect(await player.getRun(run.id)).toEqual(terminal);
  });

  it("resolves an abandon/answer race consistently with transaction order", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.unlockOk(await player.startOk("clock-walk"));
    const question = run.checkpoints[0]!.questions[0]!;
    const [abandon, answer] = await Promise.all([
      player.call("POST", `/v1/runs/${run.id}/abandon`, { body: { expectedRunRevision: run.revision, confirm: true } }),
      player.answer(run, question, { type: "numeric", value: "1924" }),
    ]);
    const final = await player.getRun(run.id);
    if (abandon.status === 200) {
      expectError(answer, "RUN_TERMINAL");
      expect(final.state).toBe("abandoned");
      expect(final.checkpoints[0]!.questions[0]!.resolution).toBe("unresolved");
    } else {
      expectError(abandon, "RUN_REVISION_CONFLICT");
      expect(answer.status).toBe(200);
      expect(final.state).toBe("active");
    }
  });

  it("treats replay as a new run and keeps history in the journal", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const first = await player.startOk("clock-walk");
    await player.call("POST", `/v1/runs/${first.id}/abandon`, {
      body: { expectedRunRevision: first.revision, confirm: true },
    });
    t.clock.advance(1000);
    const replay = await player.startOk("clock-walk");
    expect(replay.id).not.toBe(first.id);
    expect(replay).toMatchObject({ state: "active", revision: 1 });
    expect((await player.getRun(first.id)).state).toBe("abandoned");

    const all = (await player.call("GET", "/v1/runs")).body;
    expect(all.items.map((item: { id: string }) => item.id)).toEqual([replay.id, first.id]);
    expect((await player.call("GET", "/v1/runs?group=open")).body.items.map((item: { id: string }) => item.id)).toEqual(
      [replay.id],
    );
    const history = (await player.call("GET", "/v1/runs?group=history")).body;
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      id: first.id,
      state: "abandoned",
      huntTitle: "The Clockmaker's Walk",
      checkpointCount: 3,
    });
    expect(history.items[0]).not.toHaveProperty("checkpoints");
  });

  it("paginates the journal with bounded pages", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    for (let i = 0; i < 5; i += 1) {
      await player.startOk("clock-walk");
      t.clock.advance(1000);
    }
    const first = (await player.call("GET", "/v1/runs?limit=2")).body;
    const second = (await player.call("GET", `/v1/runs?limit=2&cursor=${first.nextCursor}`)).body;
    const third = (await player.call("GET", `/v1/runs?limit=2&cursor=${second.nextCursor}`)).body;
    const ids = [...first.items, ...second.items, ...third.items].map((item: { id: string }) => item.id);
    expect(new Set(ids).size).toBe(5);
    expect(third.nextCursor).toBeNull();
  });
});

describe("revisions", () => {
  it("rejects stale run revisions with a retryable conflict and no partial write", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const started = await player.startOk("clock-walk");
    const run = await player.unlockOk(started);
    const before = dumpDatabase(t.ctx);
    const question = run.checkpoints[0]!.questions[0]!;
    const stale = { ...run, revision: started.revision };

    const responses = [
      await player.answer(stale, question, { type: "numeric", value: "1924" }),
      await player.call("POST", `/v1/runs/${run.id}/questions/${question.selectedId}/hint`, {
        body: { expectedRunRevision: stale.revision },
      }),
      await player.call("POST", `/v1/runs/${run.id}/questions/${question.selectedId}/reveal`, {
        body: { expectedRunRevision: 99, confirm: true },
      }),
      await player.call("POST", `/v1/runs/${run.id}/suspend`, { body: { expectedRunRevision: stale.revision } }),
      await player.call("POST", `/v1/runs/${run.id}/abandon`, {
        body: { expectedRunRevision: stale.revision, confirm: true },
      }),
    ];
    for (const response of responses) {
      expectError(response, "RUN_REVISION_CONFLICT");
      expect(response.body.retryable).toBe(true);
    }
    expect(dumpDatabase(t.ctx)).toBe(before);
    expect(RunSnapshotSchema.parse(await player.getRun(run.id))).toEqual(run);
  });
});
