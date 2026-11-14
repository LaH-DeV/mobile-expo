import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compileHuntVersion,
  loadContentDirectory,
  validateHuntSource,
  type ContentRelease,
  type HuntSource,
} from "@signal-hunt/content-tools";
import { ERRORS, ErrorEnvelopeSchema, type ErrorCode } from "@signal-hunt/contracts";
import { expect } from "vitest";
import type {
  AnswerInput,
  Coordinates,
  Locale,
  LocationFix,
  RevealedCheckpoint,
  RunSnapshot,
  SelectedQuestion,
} from "@signal-hunt/contracts";
import type { FastifyInstance } from "fastify";
import geodesic from "geographiclib-geodesic";
import { buildApp } from "../src/app";
import {
  createHasher,
  cryptoRandom,
  wgs84Distance,
  type Clock,
  type RandomSource,
} from "../src/infrastructure/adapters";
import { REPO_ROOT, parseConfig, type Config } from "../src/infrastructure/config";
import type { AppContext } from "../src/infrastructure/context";
import { applyMigrations, openDatabase } from "../src/infrastructure/db/client";
import { registerRelease } from "../src/modules/content/release";
import { ContentStore } from "../src/modules/content/store";

// Test-only doubles. They live under test/ and are never imported by src/.

export const SYNTHETIC_DIR = resolve(REPO_ROOT, "content/synthetic");
export const DAY_MS = 24 * 60 * 60 * 1000;

export class FakeClock implements Clock {
  constructor(public time = Date.parse("2026-06-01T10:00:00.000Z")) {}
  now(): number {
    return this.time;
  }
  advance(ms: number): void {
    this.time += ms;
  }
}

export function syntheticRelease(): ContentRelease {
  const loaded = loadContentDirectory(SYNTHETIC_DIR);
  if (!loaded.ok) throw new Error(`Synthetic fixtures are invalid: ${JSON.stringify(loaded.issues)}`);
  return loaded.release;
}

export function syntheticSource(huntId: string): HuntSource {
  const raw: unknown = JSON.parse(readFileSync(resolve(SYNTHETIC_DIR, "hunts", huntId, "v1.json"), "utf8"));
  const result = validateHuntSource(raw);
  if (!result.ok) throw new Error("Synthetic fixture is invalid");
  return result.value;
}

/** Public synthetic token from the fixture; it is not a secret. */
export function syntheticQrPayload(): string {
  const finale = syntheticSource("demo-square").finale;
  if (finale.type !== "qr") throw new Error("demo-square must be a QR hunt");
  return `signal-hunt:qr:v1:${finale.qrToken}`;
}

export function compileSource(source: HuntSource) {
  const result = validateHuntSource(JSON.parse(JSON.stringify(source)));
  if (!result.ok) throw new Error(`Invalid test source: ${JSON.stringify(result.issues)}`);
  return compileHuntVersion(result.value);
}

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  clock: FakeClock;
  logs: string[];
  close(): Promise<void>;
}

export interface TestAppOptions {
  databasePath?: string;
  env?: Record<string, string>;
  clock?: FakeClock;
  random?: RandomSource;
  release?: ContentRelease | null;
}

export function testConfig(env: Record<string, string> = {}): Config {
  return parseConfig({
    NODE_ENV: "test",
    DATABASE_PATH: ":memory:",
    FINGERPRINT_SECRET: "test-only-fingerprint-secret-0123456789",
    ALLOW_INSECURE_HTTP: "true",
    LOG_LEVEL: "info",
    RATE_LIMIT_GLOBAL_PER_MINUTE: "100000",
    RATE_LIMIT_MUTATION_PER_MINUTE: "100000",
    RATE_LIMIT_PROVISION_PER_HOUR: "100000",
    ...env,
  });
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const config = testConfig({
    ...(options.databasePath ? { DATABASE_PATH: options.databasePath } : {}),
    ...options.env,
  });
  const clock = options.clock ?? new FakeClock();
  const database = openDatabase(config.databasePath);
  applyMigrations(database);
  const ctx: AppContext = {
    config,
    database,
    clock,
    random: options.random ?? cryptoRandom,
    hasher: createHasher(config.fingerprintSecret),
    distance: wgs84Distance,
    content: new ContentStore(),
  };
  const release = options.release === undefined ? syntheticRelease() : options.release;
  if (release) {
    const registered = registerRelease(database, release, clock.now());
    if (!registered.ok) throw new Error(`Release rejected: ${JSON.stringify(registered.issues)}`);
  }
  const logs: string[] = [];
  const app = await buildApp(ctx, { logStream: { write: (line) => void logs.push(line) } });
  return {
    app,
    ctx,
    clock,
    logs,
    close: async () => {
      await app.close();
      database.close();
    },
  };
}

/** Every row of every table as one string, for "nothing private is persisted" assertions. */
export function dumpDatabase(ctx: AppContext): string {
  const tables = ctx.database.sqlite
    .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
    .all() as { name: string }[];
  return tables
    .map(
      (table) => `${table.name}:${JSON.stringify(ctx.database.sqlite.prepare(`select * from "${table.name}"`).all())}`,
    )
    .join("\n");
}

/** A point `meters` due north of `origin`. */
export function northOf(origin: Coordinates, meters: number): Coordinates {
  const result = geodesic.Geodesic.WGS84.Direct(origin.latitude, origin.longitude, 0, meters);
  return { latitude: result.lat2 as number, longitude: result.lon2 as number };
}

export interface FixOptions {
  northMeters?: number;
  accuracyMeters?: number;
  ageMs?: number;
}

export function fixNear(target: Coordinates, clock: Clock, options: FixOptions = {}): LocationFix {
  const point = northOf(target, options.northMeters ?? 5);
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    accuracyMeters: options.accuracyMeters ?? 8,
    capturedAt: new Date(clock.now() - (options.ageMs ?? 1000)).toISOString(),
  };
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Record<string, string | string[] | number | undefined>;
}

export interface CallOptions {
  body?: unknown;
  /** Idempotency key; `null` omits the header, undefined generates a fresh one for POSTs. */
  key?: string | null;
  headers?: Record<string, string>;
  locale?: Locale | null;
  auth?: boolean;
}

/** A synthetic installation driving the API through Fastify injection. */
export class Player {
  locale: Locale = "en";

  constructor(
    readonly t: TestApp,
    readonly credential: string,
    readonly installationId: string,
  ) {}

  static async provision(t: TestApp): Promise<Player> {
    const response = await t.app.inject({ method: "POST", url: "/v1/installations" });
    if (response.statusCode !== 201) throw new Error(`Provisioning failed: ${response.body}`);
    const body = response.json<{ credential: string; installationId: string }>();
    return new Player(t, body.credential, body.installationId);
  }

  async call<T = any>(
    method: "GET" | "POST" | "DELETE",
    url: string,
    options: CallOptions = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {};
    if (options.auth !== false) headers.authorization = `Bearer ${this.credential}`;
    const locale = options.locale === undefined ? this.locale : options.locale;
    if (locale) headers["accept-language"] = locale;
    if (method === "POST" && options.key !== null) headers["idempotency-key"] = options.key ?? randomUUID();
    Object.assign(headers, options.headers);
    const response = await this.t.app.inject({
      method,
      url,
      headers,
      ...(options.body === undefined ? {} : { payload: options.body as object }),
    });
    const text = response.body;
    return { status: response.statusCode, body: text ? JSON.parse(text) : undefined, headers: response.headers };
  }

  async revision(): Promise<number> {
    return (await this.call("GET", "/v1/me")).body.installationRevision as number;
  }

  async start(huntId: string, options: CallOptions = {}, huntVersion = 1): Promise<ApiResponse> {
    return this.call("POST", "/v1/runs", {
      ...options,
      body: { huntId, huntVersion, expectedInstallationRevision: await this.revision() },
    });
  }

  async startOk(huntId: string): Promise<RunSnapshot> {
    const response = await this.start(huntId);
    if (response.status !== 201) throw new Error(`Start failed: ${JSON.stringify(response.body)}`);
    return response.body.run;
  }

  async getRun(runId: string): Promise<RunSnapshot> {
    const response = await this.call<RunSnapshot>("GET", `/v1/runs/${runId}`);
    if (response.status !== 200) throw new Error(`getRun failed: ${JSON.stringify(response.body)}`);
    return response.body;
  }

  unlock(run: RunSnapshot, fix: FixOptions = {}, options: CallOptions = {}): Promise<ApiResponse> {
    const target = currentCheckpoint(run);
    return this.call("POST", `/v1/runs/${run.id}/checkpoints/${target.id}/unlock`, {
      ...options,
      body: { expectedRunRevision: run.revision, location: fixNear(target.location, this.t.clock, fix) },
    });
  }

  async unlockOk(run: RunSnapshot): Promise<RunSnapshot> {
    const response = await this.unlock(run);
    if (response.status !== 200) throw new Error(`Unlock failed: ${JSON.stringify(response.body)}`);
    return response.body.run;
  }

  answer(run: RunSnapshot, question: SelectedQuestion, answer: AnswerInput, options: CallOptions = {}) {
    return this.call("POST", `/v1/runs/${run.id}/questions/${question.selectedId}/answer`, {
      ...options,
      body: { expectedRunRevision: run.revision, answer },
    });
  }

  /** Correctly answers every unresolved question of the current checkpoint. */
  async answerAll(run: RunSnapshot): Promise<RunSnapshot> {
    let latest = run;
    for (const question of currentCheckpoint(run).questions) {
      if (question.resolution !== "unresolved") continue;
      const response = await this.answer(latest, question, correctAnswer(latest.huntId, question, this.locale));
      if (response.status !== 200 || response.body.evaluation.result !== "correct") {
        throw new Error(`Answer failed: ${JSON.stringify(response.body)}`);
      }
      latest = response.body.run;
    }
    return latest;
  }

  scan(run: RunSnapshot, payload: string, fix: FixOptions = {}, options: CallOptions = {}) {
    const target = currentCheckpoint(run);
    return this.call("POST", `/v1/runs/${run.id}/finale/scan`, {
      ...options,
      body: { expectedRunRevision: run.revision, payload, location: fixNear(target.location, this.t.clock, fix) },
    });
  }

  /** Plays unlock + answers for every checkpoint before the finale and unlocks the finale. */
  async playToUnlockedFinale(huntId: string): Promise<RunSnapshot> {
    let run = await this.startOk(huntId);
    for (;;) {
      run = await this.unlockOk(run);
      if (currentCheckpoint(run).isFinale) return run;
      run = await this.answerAll(run);
    }
  }
}

export function currentCheckpoint(run: RunSnapshot): RevealedCheckpoint {
  const checkpoint = run.checkpoints[run.checkpoints.length - 1];
  if (!checkpoint) throw new Error("Run has no revealed checkpoint");
  return checkpoint;
}

/** Looks up the public synthetic answer for a selected question by its localized prompt. */
export function correctAnswer(huntId: string, question: SelectedQuestion, locale: Locale): AnswerInput {
  for (const checkpoint of syntheticSource(huntId).checkpoints) {
    for (const content of checkpoint.questions) {
      if (content.prompt[locale] !== question.prompt) continue;
      if (content.type === "text") return { type: "text", value: content.accepted[locale][0] as string };
      if (content.type === "numeric") return { type: "numeric", value: content.answer.value };
      const correct = content.choices.find((choice) => choice.correct);
      return { type: "choice", choiceId: correct?.id as string };
    }
  }
  throw new Error(`No fixture question matches prompt: ${question.prompt}`);
}

export function wrongAnswer(question: SelectedQuestion, huntId: string, locale: Locale): AnswerInput {
  const correct = correctAnswer(huntId, question, locale);
  if (correct.type === "text") return { type: "text", value: "definitely-not-the-answer" };
  if (correct.type === "numeric") return { type: "numeric", value: "987654" };
  const other = question.choices?.find((choice) => choice.id !== correct.choiceId);
  return { type: "choice", choiceId: other?.id as string };
}

/** Asserts a complete, schema-valid error envelope with the expected stable code. */
export function expectError(response: ApiResponse, code: ErrorCode): void {
  expect(response.body, JSON.stringify(response.body)).toMatchObject({ code });
  expect(response.status).toBe(ERRORS[code].status);
  const envelope = ErrorEnvelopeSchema.parse(response.body);
  expect(envelope.messageKey).toBe(ERRORS[code].messageKey);
  expect(envelope.retryable).toBe(ERRORS[code].retryable);
  expect(envelope.correlationId).toBe(response.headers["x-correlation-id"]);
}
