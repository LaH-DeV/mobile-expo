import { afterEach, describe, expect, it } from "vitest";
import { ConfigError } from "../src/infrastructure/config";
import { runMaintenance } from "../src/modules/installations/service";
import { DAY_MS, Player, createTestApp, dumpDatabase, expectError, testConfig, type TestApp } from "./harness";

let t: TestApp;
afterEach(async () => {
  await t?.close();
});

describe("anonymous installations", () => {
  it("issues a 256-bit credential once and stores only its hash", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    expect(player.credential).toMatch(/^sh1_[A-Za-z0-9_-]{43}$/);
    const dump = dumpDatabase(t.ctx);
    expect(dump).toContain(player.installationId);
    expect(dump).not.toContain(player.credential);
    expect(dump).not.toContain(player.credential.slice(4));
    expect(t.logs.join("")).not.toContain(player.credential.slice(4));

    const me = await player.call("GET", "/v1/me");
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      installationId: player.installationId,
      installationRevision: 0,
      activeRunId: null,
    });
    expect(JSON.stringify(me.body)).not.toContain(player.credential);
  });

  it("issues distinct identities on repeated provisioning", async () => {
    t = await createTestApp();
    const [a, b] = [await Player.provision(t), await Player.provision(t)];
    expect(a.installationId).not.toBe(b.installationId);
    expect(a.credential).not.toBe(b.credential);
  });

  it.each([
    ["missing header", undefined],
    ["wrong scheme", "Basic abc"],
    ["malformed credential", "Bearer nope"],
    ["unknown credential", `Bearer sh1_${"A".repeat(43)}`],
  ])("rejects %s with 401", async (_name, authorization) => {
    t = await createTestApp();
    const player = await Player.provision(t);
    for (const url of ["/v1/me", "/v1/runs", "/v1/runs/run_x", "/v1/operations/0123456789abcdef"]) {
      const response = await player.call("GET", url, { auth: false, headers: authorization ? { authorization } : {} });
      expectError(response, "CREDENTIAL_INVALID");
    }
  });

  it("does not accept a credential in the URL", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const response = await player.call(
      "GET",
      `/v1/me?credential=${player.credential}&access_token=${player.credential}`,
      {
        auth: false,
      },
    );
    expectError(response, "CREDENTIAL_INVALID");
  });
});

describe("ownership", () => {
  it("answers every run operation of another installation with a non-enumerating 404", async () => {
    t = await createTestApp();
    const owner = await Player.provision(t);
    const intruder = await Player.provision(t);
    const run = await owner.unlockOk(await owner.startOk("clock-walk"));
    const question = run.checkpoints[0]!.questions[0]!;
    const fix = {
      latitude: 52.2307,
      longitude: 21.0124,
      accuracyMeters: 5,
      capturedAt: new Date(t.clock.now()).toISOString(),
    };
    const revision = { expectedRunRevision: run.revision };

    const attempts: ["GET" | "POST", string, unknown][] = [
      ["GET", `/v1/runs/${run.id}`, undefined],
      ["POST", `/v1/runs/${run.id}/suspend`, revision],
      ["POST", `/v1/runs/${run.id}/abandon`, { ...revision, confirm: true }],
      ["POST", `/v1/runs/${run.id}/resume`, { ...revision, expectedInstallationRevision: 0 }],
      ["POST", `/v1/runs/${run.id}/checkpoints/gate/unlock`, { ...revision, location: fix }],
      [
        "POST",
        `/v1/runs/${run.id}/questions/${question.selectedId}/answer`,
        { ...revision, answer: { type: "numeric", value: "1924" } },
      ],
      ["POST", `/v1/runs/${run.id}/questions/${question.selectedId}/hint`, revision],
      ["POST", `/v1/runs/${run.id}/questions/${question.selectedId}/reveal`, { ...revision, confirm: true }],
      ["POST", `/v1/runs/${run.id}/finale/scan`, { ...revision, payload: "x", location: fix }],
    ];
    for (const [method, url, body] of attempts) {
      const response = await intruder.call(method, url, { body });
      expectError(response, "NOT_FOUND");
      const missing = await intruder.call(method, url.replace(run.id, "run_doesNotExist"), { body });
      expect(missing.body.code).toBe("NOT_FOUND");
    }
    expect((await intruder.call("GET", "/v1/runs")).body.items).toEqual([]);
    expect(await owner.getRun(run.id)).toEqual(run);
  });

  it("does not let a selected question ID from another run be used", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const first = await player.unlockOk(await player.startOk("clock-walk"));
    const second = await player.unlockOk(await player.startOk("clock-walk"));
    const foreign = first.checkpoints[0]!.questions[0]!;
    const response = await player.call("POST", `/v1/runs/${second.id}/questions/${foreign.selectedId}/reveal`, {
      body: { expectedRunRevision: second.revision, confirm: true },
    });
    expectError(response, "NOT_FOUND");
  });
});

describe("inactivity expiry", () => {
  it("keeps an installation used within 180 days and expires it afterwards at the API boundary", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.startOk("clock-walk");

    t.clock.advance(180 * DAY_MS);
    expect((await player.call("GET", "/v1/me")).status).toBe(200);

    t.clock.advance(180 * DAY_MS + 1);
    expectError(await player.call("GET", `/v1/runs/${run.id}`), "INSTALLATION_EXPIRED");
    expectError(await player.call("GET", "/v1/me"), "CREDENTIAL_INVALID");
    const dump = dumpDatabase(t.ctx);
    expect(dump).not.toContain(player.installationId);
    expect(dump).not.toContain(run.id);
  });

  it("does not count unauthenticated traffic as activity", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    t.clock.advance(100 * DAY_MS);
    await t.app.inject({ method: "GET", url: "/health" });
    await t.app.inject({ method: "GET", url: "/v1/hunts", headers: { "accept-language": "en" } });
    t.clock.advance(81 * DAY_MS);
    expectError(await player.call("GET", "/v1/me"), "INSTALLATION_EXPIRED");
  });

  it("expires through the maintenance command and purges bounded auxiliary records", async () => {
    t = await createTestApp();
    const stale = await Player.provision(t);
    const staleRun = await stale.startOk("clock-walk");
    t.clock.advance(170 * DAY_MS);
    const fresh = await Player.provision(t);
    const freshRun = await fresh.startOk("clock-walk");
    t.clock.advance(11 * DAY_MS);

    const report = runMaintenance(t.ctx);
    expect(report.expiredInstallations).toBe(1);
    expect(report.purgedOperations).toBe(1);
    const dump = dumpDatabase(t.ctx);
    expect(dump).not.toContain(stale.installationId);
    expect(dump).not.toContain(staleRun.id);
    expect((await fresh.getRun(freshRun.id)).state).toBe("active");
    expect(runMaintenance(t.ctx)).toEqual({ expiredInstallations: 0, purgedOperations: 0, purgedDeletionReceipts: 0 });
  });
});

describe("deletion", () => {
  const receiptHeaders = (receipt: { receiptId: string }) => ({ "x-deletion-receipt-id": receipt.receiptId });
  const status = (id: string, proof?: string) =>
    t.app.inject({
      method: "GET",
      url: `/v1/deletions/${id}`,
      headers: proof ? { "x-deletion-receipt-proof": proof } : {},
    });

  it("deletes live activity, revokes the credential and stays confirmable through the receipt", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const bystander = await Player.provision(t);
    const bystanderRun = await bystander.startOk("clock-walk");
    const run = await player.unlockOk(await player.startOk("demo-square"));

    const receipt = (await player.call("POST", "/v1/me/deletion-receipt", { key: null })).body;
    expect(receipt.receiptProof).toMatch(/^shd1_[A-Za-z0-9_-]{43}$/);
    expect(receipt.status).toBe("pending");
    expect((await status(receipt.receiptId, receipt.receiptProof)).json()).toMatchObject({
      status: "pending",
      completedAt: null,
    });

    const deleted = await player.call("DELETE", "/v1/me", { headers: receiptHeaders(receipt) });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ receiptId: receipt.receiptId, status: "completed" });

    // The response may be lost: the credential is revoked, the receipt still confirms deletion.
    expectError(await player.call("DELETE", "/v1/me", { headers: receiptHeaders(receipt) }), "CREDENTIAL_INVALID");
    expectError(await player.call("GET", `/v1/runs/${run.id}`), "CREDENTIAL_INVALID");
    const confirmed = await status(receipt.receiptId, receipt.receiptProof);
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ receiptId: receipt.receiptId, status: "completed" });
    expect(confirmed.json().completedAt).not.toBeNull();

    const dump = dumpDatabase(t.ctx);
    expect(dump).not.toContain(player.installationId);
    expect(dump).not.toContain(run.id);
    expect(dump).not.toContain(receipt.receiptProof);
    expect((await bystander.getRun(bystanderRun.id)).state).toBe("active");
  });

  it("gives the receipt no gameplay authority", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.startOk("clock-walk");
    const receipt = (await player.call("POST", "/v1/me/deletion-receipt", { key: null })).body;
    for (const authorization of [`Bearer ${receipt.receiptProof}`, `Bearer ${receipt.receiptId}`]) {
      const response = await player.call("GET", `/v1/runs/${run.id}`, { auth: false, headers: { authorization } });
      expectError(response, "CREDENTIAL_INVALID");
    }
  });

  it("requires the private proof: an ID alone, a wrong proof and unknown IDs all look the same", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const receipt = (await player.call("POST", "/v1/me/deletion-receipt", { key: null })).body;
    const responses = [
      await status(receipt.receiptId),
      await status(receipt.receiptId, `shd1_${"A".repeat(43)}`),
      await status("del_unknownReceipt", receipt.receiptProof),
      await t.app.inject({ method: "GET", url: `/v1/deletions/${receipt.receiptId}?proof=${receipt.receiptProof}` }),
    ];
    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe("NOT_FOUND");
    }
  });

  it("can repeat receipt setup after an interrupted response; only the latest receipt works", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const lost = (await player.call("POST", "/v1/me/deletion-receipt", { key: null })).body;
    const kept = (await player.call("POST", "/v1/me/deletion-receipt", { key: null })).body;
    expect(kept.receiptId).not.toBe(lost.receiptId);
    expect((await status(lost.receiptId, lost.receiptProof)).statusCode).toBe(404);

    expectError(await player.call("DELETE", "/v1/me", { headers: receiptHeaders(lost) }), "DELETION_RECEIPT_INVALID");
    expect((await player.call("GET", "/v1/me")).status).toBe(200);
    expect((await player.call("DELETE", "/v1/me", { headers: receiptHeaders(kept) })).status).toBe(200);
  });

  it("refuses deletion without a valid own receipt and changes nothing", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const other = await Player.provision(t);
    const foreign = (await other.call("POST", "/v1/me/deletion-receipt", { key: null })).body;
    expectError(await player.call("DELETE", "/v1/me"), "DELETION_RECEIPT_INVALID");
    expectError(
      await player.call("DELETE", "/v1/me", { headers: receiptHeaders(foreign) }),
      "DELETION_RECEIPT_INVALID",
    );

    const expired = (await player.call("POST", "/v1/me/deletion-receipt", { key: null })).body;
    t.clock.advance(DAY_MS + 1);
    expectError(
      await player.call("DELETE", "/v1/me", { headers: receiptHeaders(expired) }),
      "DELETION_RECEIPT_INVALID",
    );
    expect((await status(expired.receiptId, expired.receiptProof)).statusCode).toBe(404);
    expect((await player.call("GET", "/v1/me")).status).toBe(200);
    expect((await other.call("GET", "/v1/me")).status).toBe(200);
  });

  it("completes a pending receipt when inactivity expiry removes the installation", async () => {
    t = await createTestApp({ env: { DELETION_RECEIPT_PENDING_HOURS: String(24 * 400) } });
    const player = await Player.provision(t);
    const receipt = (await player.call("POST", "/v1/me/deletion-receipt", { key: null })).body;
    t.clock.advance(181 * DAY_MS);
    expect(runMaintenance(t.ctx).expiredInstallations).toBe(1);
    expect((await status(receipt.receiptId, receipt.receiptProof)).json()).toMatchObject({ status: "completed" });
  });
});

describe("transport policy and request limits", () => {
  it("refuses insecure production configuration and configuration without any HTTPS path", () => {
    expect(() => testConfig({ NODE_ENV: "production" })).toThrow(ConfigError);
    expect(() => testConfig({ ALLOW_INSECURE_HTTP: "false" })).toThrow(ConfigError);
    expect(() => testConfig({ FINGERPRINT_SECRET: "short" })).toThrow(/FINGERPRINT_SECRET/);
    expect(
      testConfig({ NODE_ENV: "production", ALLOW_INSECURE_HTTP: "false", TRUST_PROXY: "true" }).allowInsecureHttp,
    ).toBe(false);
  });

  it("requires HTTPS unless the explicit local-development exception is set", async () => {
    t = await createTestApp({ env: { ALLOW_INSECURE_HTTP: "false", TRUST_PROXY: "true" } });
    const headers = { "accept-language": "en" };
    const plain = await t.app.inject({ method: "GET", url: "/v1/hunts", headers });
    expect(plain.statusCode).toBe(400);
    expect(plain.json().code).toBe("INSECURE_TRANSPORT");
    expect((await t.app.inject({ method: "POST", url: "/v1/installations" })).statusCode).toBe(400);

    const secure = await t.app.inject({
      method: "GET",
      url: "/v1/hunts",
      headers: { ...headers, "x-forwarded-proto": "https" },
    });
    expect(secure.statusCode).toBe(200);
    expect(secure.headers["strict-transport-security"]).toContain("max-age");
    expect((await t.app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });

  it("rate-limits provisioning with a retryable envelope, not a ban", async () => {
    t = await createTestApp({ env: { RATE_LIMIT_PROVISION_PER_HOUR: "2" } });
    await Player.provision(t);
    await Player.provision(t);
    const limited = await t.app.inject({ method: "POST", url: "/v1/installations" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(limited.json().params.retryAfterSeconds).toBeGreaterThan(0);
    expect(limited.headers["retry-after"]).toBeDefined();
    // Other routes keep working for the same client.
    expect(
      (await t.app.inject({ method: "GET", url: "/v1/hunts", headers: { "accept-language": "pl" } })).statusCode,
    ).toBe(200);
  });

  it("rate-limits mutations independently of gameplay attempt rules", async () => {
    t = await createTestApp({ env: { RATE_LIMIT_MUTATION_PER_MINUTE: "3" } });
    const player = await Player.provision(t);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1)
      statuses.push((await player.call("POST", "/v1/runs/run_x/suspend", { body: { expectedRunRevision: 1 } })).status);
    expect(statuses).toEqual([404, 404, 404, 429, 429]);
  });

  it("bounds and validates input with safe errors", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const start = { huntId: "clock-walk", huntVersion: 1, expectedInstallationRevision: 0 };

    expectError(
      await player.call("POST", "/v1/runs", { body: { ...start, padding: "x".repeat(20_000) } }),
      "PAYLOAD_TOO_LARGE",
    );

    const unknownField = await player.call("POST", "/v1/runs", {
      body: { ...start, runId: "run_mine", completed: true },
    });
    expectError(unknownField, "INVALID_REQUEST");
    expect(JSON.stringify(unknownField.body)).not.toContain("run_mine");

    const malformed = await t.app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: {
        authorization: `Bearer ${player.credential}`,
        "content-type": "application/json",
        "accept-language": "en",
      },
      payload: "{not json",
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().code).toBe("INVALID_REQUEST");

    expectError(await player.call("POST", "/v1/runs", { body: start, key: null }), "IDEMPOTENCY_KEY_INVALID");
    expectError(await player.call("POST", "/v1/runs", { body: start, key: "short" }), "IDEMPOTENCY_KEY_INVALID");
    expectError(await player.call("GET", "/v1/runs?limit=51"), "INVALID_REQUEST");
    expectError(await player.call("GET", "/v1/runs?limit=abc"), "INVALID_REQUEST");
    expectError(await player.call("GET", "/v1/nope"), "NOT_FOUND");
    expect((await player.call("GET", "/v1/me")).body.installationRevision).toBe(0);
  });

  it("reports readiness without diagnostics and fails it when content is missing", async () => {
    t = await createTestApp();
    const ready = await t.app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: "ready", checks: { database: true, schema: true, content: true } });
    expect((await t.app.inject({ method: "GET", url: "/health" })).json()).toEqual({ status: "ok" });
    await t.close();

    t = await createTestApp({ release: null });
    const notReady = await t.app.inject({ method: "GET", url: "/ready" });
    expect(notReady.statusCode).toBe(503);
    expect(notReady.json()).toEqual({ status: "not_ready", checks: { database: true, schema: true, content: false } });
  });

  it("fails readiness when a stored version no longer matches its digest", async () => {
    t = await createTestApp();
    t.ctx.database.sqlite
      .prepare("update hunt_versions set document = replace(document, '1924', '1925') where hunt_id = 'clock-walk'")
      .run();
    const response = await t.app.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json().checks.content).toBe(false);
  });
});
