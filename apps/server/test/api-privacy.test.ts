import { randomUUID } from "node:crypto";
import { HuntDetailSchema, ListHuntsResponseSchema, ROUTES, type RunSnapshot } from "@signal-hunt/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../src/openapi";
import {
  Player,
  createTestApp,
  currentCheckpoint,
  dumpDatabase,
  expectError,
  fixNear,
  syntheticQrPayload,
  syntheticSource,
  type TestApp,
} from "./harness";

let t: TestApp;
afterEach(async () => {
  await t?.close();
});

/**
 * Private strings of a synthetic hunt: reveal texts, later coordinates, and accepted aliases.
 * The fictional story and titles deliberately mention some answers (a "copper clock"), so only
 * aliases that appear nowhere in player-visible text are used as leak markers.
 */
function privateStrings(huntId: string) {
  const source = syntheticSource(huntId);
  const aliases: string[] = [];
  const visible: string[] = [source.title.pl, source.title.en, source.story.pl, source.story.en];
  const reveals: string[] = [];
  const laterCoordinates: string[] = [];
  source.checkpoints.forEach((checkpoint, index) => {
    if (index > 0) laterCoordinates.push(String(checkpoint.location.latitude), String(checkpoint.location.longitude));
    visible.push(checkpoint.title.pl, checkpoint.title.en);
    for (const question of checkpoint.questions) {
      reveals.push(question.reveal.explanation.pl, question.reveal.explanation.en);
      visible.push(question.prompt.pl, question.prompt.en, ...question.hints.flatMap((hint) => [hint.pl, hint.en]));
      if (question.type === "text") aliases.push(...question.accepted.pl, ...question.accepted.en);
    }
  });
  const publicText = visible.join(" | ").toLowerCase();
  const answers = aliases.filter((alias) => !publicText.includes(alias.toLowerCase()));
  return { source, answers, reveals, laterCoordinates };
}

describe("catalog", () => {
  it("lists available hunts with safe localized metadata", async () => {
    t = await createTestApp();
    for (const [locale, title] of [
      ["pl", "Sekret placu"],
      ["en", "The Square's Secret"],
    ] as const) {
      const response = await t.app.inject({ method: "GET", url: "/v1/hunts", headers: { "accept-language": locale } });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-language"]).toBe(locale);
      expect(response.headers.vary).toContain("Accept-Language");
      const body = ListHuntsResponseSchema.parse(response.json());
      expect(body.items.map((item) => item.id)).toEqual(["clock-walk", "demo-square"]);
      const square = body.items[1]!;
      expect(square).toMatchObject({
        title,
        version: 1,
        difficulty: "easy",
        finaleType: "qr",
        estimatedLengthMeters: 800,
        estimatedDurationMinutes: 25,
        contentLocales: ["pl", "en"],
        start: { latitude: 52.23, longitude: 21.01 },
        availability: { available: true, reasonCode: null },
      });
    }
  });

  it("supports bounded search and pagination", async () => {
    t = await createTestApp();
    const get = async (url: string, locale = "en") =>
      (await t.app.inject({ method: "GET", url, headers: { "accept-language": locale } })).json();
    expect((await get("/v1/hunts?q=SQUARE")).items.map((item: { id: string }) => item.id)).toEqual(["demo-square"]);
    expect((await get("/v1/hunts?q=zegarmistrza", "pl")).items.map((item: { id: string }) => item.id)).toEqual([
      "clock-walk",
    ]);
    expect((await get("/v1/hunts?q=zegarmistrza", "en")).items).toEqual([]);
    const first = await get("/v1/hunts?limit=1");
    expect(first.items).toHaveLength(1);
    const second = await get(`/v1/hunts?limit=1&cursor=${first.nextCursor}`);
    expect(second.items[0].id).toBe("demo-square");
    expect(second.nextCursor).toBeNull();
    expect((await get(`/v1/hunts?q=${"x".repeat(101)}`)).code).toBe("INVALID_REQUEST");
    expect((await get("/v1/hunts?limit=0")).code).toBe("INVALID_REQUEST");
    expect((await get("/v1/hunts?sort=distance&lat=52.2&lon=21.0")).code).toBe("INVALID_REQUEST");
  });

  it("returns details with the public start only", async () => {
    t = await createTestApp();
    const response = await t.app.inject({
      method: "GET",
      url: "/v1/hunts/demo-square",
      headers: { "accept-language": "en" },
    });
    const detail = HuntDetailSchema.parse(response.json());
    expect(detail).toMatchObject({
      checkpointCount: 3,
      requiresCamera: true,
      terrainNotes: "Paving stones and two steps at the pavilion.",
      startDescription: "Start at the square's north gate.",
    });
    const missing = await t.app.inject({
      method: "GET",
      url: "/v1/hunts/unknown-hunt",
      headers: { "accept-language": "en" },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("never exposes later coordinates, pools, answers or QR material without authorization", async () => {
    t = await createTestApp();
    for (const huntId of ["demo-square", "clock-walk"]) {
      const { answers, reveals, laterCoordinates } = privateStrings(huntId);
      const bodies: string[] = [];
      for (const locale of ["pl", "en"]) {
        const headers = { "accept-language": locale };
        bodies.push((await t.app.inject({ method: "GET", url: "/v1/hunts", headers })).body);
        bodies.push((await t.app.inject({ method: "GET", url: `/v1/hunts/${huntId}`, headers })).body);
      }
      const text = bodies.join("\n");
      expect(answers.length).toBeGreaterThan(0);
      for (const secret of [...reveals, ...laterCoordinates, ...answers]) {
        expect(text, secret).not.toContain(secret);
      }
      expect(text).not.toMatch(
        /accepted|"correct"|tolerance|qrToken|tokenHash|"hints"|"questions"|"checkpoints"|drawCount|radiusReason/,
      );
      expect(text).not.toContain(syntheticQrPayload().split(":").pop());
    }
  });
});

describe("ordered revelation in run snapshots", () => {
  it("reveals each checkpoint only when reached and only the drawn questions without answer data", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const { source, answers, reveals } = privateStrings("demo-square");
    const token = syntheticQrPayload().split(":").pop()!;
    const allPrompts = source.checkpoints.map((checkpoint) =>
      checkpoint.questions.map((question) => question.prompt.en),
    );

    const assertSafe = (run: RunSnapshot, reachedIndex: number, unlocked: boolean) => {
      const text = JSON.stringify(run);
      expect(run.checkpoints).toHaveLength(reachedIndex + 1);
      source.checkpoints.forEach((checkpoint, index) => {
        if (index > reachedIndex) {
          expect(text).not.toContain(String(checkpoint.location.latitude));
          expect(text).not.toContain(checkpoint.title.en);
        }
        if (index > reachedIndex || (index === reachedIndex && !unlocked)) {
          for (const prompt of allPrompts[index]!) expect(text).not.toContain(prompt);
        }
      });
      expect(text).not.toMatch(/accepted|"correct":|tolerance|qrToken|tokenHash|drawCount|questionId/);
      expect(text).not.toContain(token);
      for (const secret of [...reveals, ...answers]) expect(text).not.toContain(secret);
    };

    let run = await player.startOk("demo-square");
    assertSafe(run, 0, false);
    for (let index = 0; index < 3; index += 1) {
      run = await player.unlockOk(run);
      assertSafe(run, index, true);
      const drawn = currentCheckpoint(run).questions.map((question) => question.prompt);
      expect(drawn).toHaveLength(source.checkpoints[index]!.drawCount);
      for (const prompt of drawn) expect(allPrompts[index]).toContain(prompt);
      if (index < 2) {
        run = await player.answerAll(run);
        assertSafe(run, index + 1, false);
      }
    }
    // Journal summaries never carry checkpoint data.
    const journal = JSON.stringify((await player.call("GET", "/v1/runs")).body);
    expect(journal).not.toMatch(/"checkpoints"|"location"|"prompt"/);
  });
});

describe("no private input in logs, database or errors", () => {
  it("keeps credentials, fixes, answers and QR payloads out of logs and persisted rows", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const wrongText = "zz-private-attempt-zz";
    const wrongToken = "W".repeat(43);

    let run = await player.unlockOk(await player.startOk("clock-walk"));
    run = await player.unlockOk(await player.answerAll(run));
    const textQuestion = currentCheckpoint(run).questions.find((question) => question.type === "text")!;
    await player.answer(run, textQuestion, { type: "text", value: wrongText });
    await player.answer(run, currentCheckpoint(run).questions[0]!, { type: "numeric", value: "424242.4242" });

    let qr = await player.playToUnlockedFinale("demo-square");
    const fix = fixNear(currentCheckpoint(qr).location, t.clock, { northMeters: 3.21, accuracyMeters: 7.77 });
    const scanUrl = `/v1/runs/${qr.id}/finale/scan`;
    await player.call("POST", scanUrl, {
      body: { expectedRunRevision: qr.revision, payload: `signal-hunt:qr:v1:${wrongToken}`, location: fix },
    });
    const far = fixNear(currentCheckpoint(qr).location, t.clock, { northMeters: 77.7 });
    await player.call("POST", scanUrl, {
      body: { expectedRunRevision: qr.revision, payload: syntheticQrPayload(), location: far },
    });
    const scanned = await player.call("POST", scanUrl, {
      body: { expectedRunRevision: qr.revision, payload: syntheticQrPayload(), location: fix },
      key: randomUUID(),
    });
    expect(scanned.status).toBe(200);
    qr = scanned.body.run;
    const receipt = (await player.call("POST", "/v1/me/deletion-receipt", { key: null })).body;
    // Provoke an internal error path too: its log entry must stay generic.
    await player.call("GET", "/v1/runs?cursor=AAAA");

    const forbidden = [
      player.credential,
      player.credential.slice(4),
      receipt.receiptProof,
      wrongText,
      "424242.4242",
      wrongToken,
      syntheticQrPayload(),
      syntheticQrPayload().split(":").pop()!,
      String(fix.latitude),
      String(far.latitude),
      fix.capturedAt,
      "7.77",
    ];
    const logs = t.logs.join("");
    expect(t.logs.length).toBeGreaterThanOrEqual(15);
    for (const value of forbidden) expect(logs, `log contains ${value}`).not.toContain(value);
    expect(logs).not.toMatch(/authorization|accept-language|"body"|"headers"|"url"|"params"/i);
    expect(logs).not.toContain(qr.id);
    expect(logs).toContain("/v1/runs/:runId/finale/scan");
    expect(logs).toContain("LOCATION_TOO_FAR");

    // The registered private content legitimately holds answers; player input must not be anywhere.
    const playerRows = dumpDatabase(t.ctx)
      .split("\n")
      .filter((line) => !line.startsWith("hunt_versions:") && !line.startsWith("cache_verifiers:"))
      .join("\n");
    for (const value of forbidden) expect(playerRows, `database contains ${value}`).not.toContain(value);
    expect(dumpDatabase(t.ctx)).not.toContain(syntheticQrPayload().split(":").pop());
    expect(playerRows).not.toMatch(/accuracyMeters|capturedAt|"payload"/);
    expect(playerRows).toContain(qr.id);
  });

  it("returns generic internal errors without stack, SQL or content details", async () => {
    t = await createTestApp();
    const player = await Player.provision(t);
    const run = await player.startOk("clock-walk");
    t.ctx.database.sqlite.exec("drop table run_finales");
    const response = await player.call("GET", `/v1/runs/${run.id}`);
    expectError(response, "INTERNAL_ERROR");
    expect(Object.keys(response.body).sort()).toEqual(["code", "correlationId", "messageKey", "params", "retryable"]);
    expect(JSON.stringify(response.body)).not.toMatch(/run_finales|sqlite|select|stack|Error:/i);
    const errorLog = t.logs.find((line) => line.includes("unhandled error"))!;
    expect(errorLog).toBeDefined();
    expect(errorLog).not.toMatch(/select |from |run_finales/i);
  });
});

describe("OpenAPI description", () => {
  it("is served and covers every contract route with strict request bodies", async () => {
    t = await createTestApp();
    const served = await t.app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(served.statusCode).toBe(200);
    const document = served.json();
    expect(document).toEqual(JSON.parse(JSON.stringify(buildOpenApiDocument())));
    expect(document.openapi).toBe("3.1.0");
    for (const [name, route] of Object.entries(ROUTES)) {
      const operation = document.paths[route.path.replace(/:([A-Za-z]+)/g, "{$1}")]?.[route.method.toLowerCase()];
      expect(operation, name).toBeDefined();
      expect(operation.operationId).toBe(name);
      expect(Object.keys(operation.responses)).toContain(String(route.successStatus));
      if ("body" in route) {
        expect(operation.requestBody.content["application/json"].schema.additionalProperties, name).toBe(false);
      }
    }
    const unlock = document.paths["/v1/runs/{runId}/checkpoints/{checkpointId}/unlock"].post;
    expect(unlock.parameters.map((parameter: { name: string }) => parameter.name)).toEqual(
      expect.arrayContaining(["runId", "checkpointId", "Accept-Language", "Idempotency-Key"]),
    );
  });

  it("registers exactly the contract routes plus the OpenAPI document", async () => {
    t = await createTestApp();
    const routes = t.app.printRoutes({ commonPrefix: false });
    for (const route of Object.values(ROUTES)) {
      const probe = await t.app.inject({ method: route.method, url: route.path.replace(/:[A-Za-z]+/g, "x") });
      expect(
        probe.statusCode === 404 && probe.json().messageKey === "request.errors.notFound" && route.auth === "none",
      ).toBe(false);
    }
    expect(routes).not.toMatch(/admin|import|content|debug|players/i);
  });
});
