import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import rateLimit from "@fastify/rate-limit";
import { HEADERS, LIMITS, ROUTES, type ErrorCode, type ReadyResponse } from "@signal-hunt/contracts";
import { sql } from "drizzle-orm";
import Fastify, { LogController, type FastifyError, type FastifyInstance } from "fastify";
import type { AppContext } from "./infrastructure/context";
import { MIGRATIONS_FOLDER } from "./infrastructure/db/client";
import { AppError, toEnvelope } from "./infrastructure/errors";
import { defineRoute } from "./infrastructure/http/route";
import { getHunt, listHunts } from "./modules/catalog/use-cases";
import { unlockCheckpoint } from "./modules/checkpoints/use-cases";
import { verifyRegisteredContent } from "./modules/content/release";
import { scanFinale } from "./modules/finales/use-cases";
import {
  createDeletionReceipt,
  deleteMe,
  getDeletionStatus,
  getMe,
  provisionInstallation,
} from "./modules/installations/service";
import { getOperationStatus } from "./modules/operations/use-cases";
import { answerQuestion, revealAnswer, revealHint } from "./modules/questions/use-cases";
import { abandonRun, getRun, listRuns, resumeRun, startRun, suspendRun } from "./modules/runs/use-cases";
import { buildOpenApiDocument } from "./openapi";

export interface BuildAppOptions {
  /** Destination for structured logs (tests capture it to assert nothing private is logged). */
  logStream?: { write(line: string): void };
}

declare module "fastify" {
  interface FastifyReply {
    /** Public error code of the response, recorded for the allowlisted access log. */
    errorCode?: ErrorCode;
  }
}

function expectedMigrationCount(): number {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8")) as {
    entries: unknown[];
  };
  return journal.entries.length;
}

/** Readiness: database reachable, all migrations applied, registered content intact. */
export function checkReadiness(ctx: AppContext): ReadyResponse {
  const checks = { database: false, schema: false, content: false };
  try {
    ctx.database.db.get(sql`select 1`);
    checks.database = true;
    const applied = ctx.database.db.get<{ count: number }>(sql`select count(*) as count from __drizzle_migrations`);
    checks.schema = applied?.count === expectedMigrationCount();
    checks.content = checks.schema && verifyRegisteredContent(ctx.database.db);
  } catch {
    // Leave the failed checks false; details stay out of the public response.
  }
  return { status: checks.database && checks.schema && checks.content ? "ready" : "not_ready", checks };
}

function classify(error: FastifyError | AppError | Error): AppError {
  if (error instanceof AppError) return error;
  const status = "statusCode" in error ? error.statusCode : undefined;
  const code = "code" in error ? String(error.code) : "";
  const causeCode = String((error as { cause?: { code?: unknown } }).cause?.code ?? "");
  if (code === "FST_ERR_CTP_BODY_TOO_LARGE" || status === 413) return new AppError("PAYLOAD_TOO_LARGE");
  if (code === "SQLITE_BUSY" || causeCode === "SQLITE_BUSY" || status === 503)
    return new AppError("SERVICE_UNAVAILABLE");
  if (status === 404) return new AppError("NOT_FOUND");
  if (typeof status === "number" && status >= 400 && status < 500) return new AppError("INVALID_REQUEST");
  return new AppError("INTERNAL_ERROR");
}

export async function buildApp(ctx: AppContext, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { config } = ctx;
  const app = Fastify({
    logger: {
      level: config.logLevel,
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
    // Request/response logging is replaced by the allowlisted `onResponse` entry below, so URLs
    // (run IDs, operation keys), headers (credentials) and bodies (fixes, answers) are never logged.
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    bodyLimit: LIMITS.requestBodyBytes,
    requestTimeout: config.requestTimeoutMs,
    connectionTimeout: config.requestTimeoutMs,
    keepAliveTimeout: 5_000,
    trustProxy: config.trustProxy,
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header(HEADERS.correlationId, request.id);
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    if (request.protocol === "https") {
      reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    } else if (!config.allowInsecureHttp && request.url !== ROUTES.health.path) {
      // Production policy. Plain HTTP is served only under the explicit local-development flag.
      throw new AppError("INSECURE_TRANSPORT");
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        correlationId: request.id,
        method: request.method,
        route: request.routeOptions.url ?? "unmatched",
        statusCode: reply.statusCode,
        errorCode: reply.errorCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      "request completed",
    );
  });

  app.setErrorHandler((error: FastifyError | AppError | Error, request, reply) => {
    const appError = classify(error);
    if (appError.code === "INTERNAL_ERROR") {
      // Only the error class and driver code: messages can embed SQL parameters.
      const cause = (error as { cause?: { code?: unknown } }).cause;
      request.log.error(
        {
          correlationId: request.id,
          errorName: error.name,
          errorCode: (error as { code?: unknown }).code,
          causeCode: cause?.code,
        },
        "unhandled error",
      );
    }
    reply.errorCode = appError.code;
    return reply.code(appError.statusCode).send(toEnvelope(appError, request.id));
  });

  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.globalPerMinute,
    timeWindow: 60 * 1000,
    errorResponseBuilder: (_request, context) =>
      new AppError("RATE_LIMITED", { retryAfterSeconds: Math.max(1, Math.ceil(context.ttl / 1000)) }),
  });

  app.setNotFoundHandler({ preHandler: app.rateLimit() }, (request, reply) => {
    reply.errorCode = "NOT_FOUND";
    return reply.code(404).send(toEnvelope(new AppError("NOT_FOUND"), request.id));
  });

  // --- Infrastructure -----------------------------------------------------------------------
  defineRoute(app, ctx, ROUTES.health, () => ({ status: "ok" as const }));
  app.get(ROUTES.ready.path, (_request, reply) => {
    const readiness = checkReadiness(ctx);
    return reply.code(readiness.status === "ready" ? 200 : 503).send(readiness);
  });
  const openApiDocument = buildOpenApiDocument();
  app.get("/v1/openapi.json", () => openApiDocument);

  // --- Catalog ------------------------------------------------------------------------------
  defineRoute(app, ctx, ROUTES.listHunts, ({ query, locale }) => listHunts(ctx, query, locale));
  defineRoute(app, ctx, ROUTES.getHunt, ({ params, locale }) => getHunt(ctx, params.huntId, locale));

  // --- Installations ------------------------------------------------------------------------
  defineRoute(app, ctx, ROUTES.provisionInstallation, () => provisionInstallation(ctx));
  defineRoute(app, ctx, ROUTES.getMe, ({ installation }) => getMe(ctx, installation));
  defineRoute(app, ctx, ROUTES.createDeletionReceipt, ({ installation }) => createDeletionReceipt(ctx, installation));
  defineRoute(app, ctx, ROUTES.deleteMe, ({ installation, header }) => {
    const receiptId = header(HEADERS.deletionReceiptId);
    if (!receiptId || !/^[A-Za-z0-9_-]{1,64}$/.test(receiptId)) throw new AppError("DELETION_RECEIPT_INVALID");
    return deleteMe(ctx, installation, receiptId);
  });
  defineRoute(app, ctx, ROUTES.getDeletion, ({ params, header }) =>
    getDeletionStatus(ctx, params.receiptId, header(HEADERS.deletionReceiptProof)),
  );
  defineRoute(app, ctx, ROUTES.getOperation, ({ installation, params }) =>
    getOperationStatus(ctx, installation.id, params.operationKey),
  );

  // --- Runs ---------------------------------------------------------------------------------
  defineRoute(app, ctx, ROUTES.listRuns, ({ installation, query, locale }) =>
    listRuns(ctx, installation.id, query, locale),
  );
  defineRoute(app, ctx, ROUTES.getRun, ({ installation, params, locale }) =>
    getRun(ctx, installation.id, params.runId, locale),
  );
  defineRoute(app, ctx, ROUTES.startRun, ({ installation, locale, now, db, body }) =>
    startRun(ctx, db, { installationId: installation.id, locale, now }, body),
  );
  defineRoute(app, ctx, ROUTES.resumeRun, ({ installation, locale, now, db, params, body }) =>
    resumeRun(ctx, db, { installationId: installation.id, locale, now }, params.runId, body),
  );
  defineRoute(app, ctx, ROUTES.suspendRun, ({ installation, locale, now, db, params, body }) =>
    suspendRun(ctx, db, { installationId: installation.id, locale, now }, params.runId, body),
  );
  defineRoute(app, ctx, ROUTES.abandonRun, ({ installation, locale, now, db, params, body }) =>
    abandonRun(ctx, db, { installationId: installation.id, locale, now }, params.runId, body),
  );

  // --- Checkpoints, questions, finales ------------------------------------------------------
  defineRoute(app, ctx, ROUTES.unlockCheckpoint, ({ installation, locale, now, db, params, body }) =>
    unlockCheckpoint(
      ctx,
      db,
      { installationId: installation.id, locale, now },
      params.runId,
      params.checkpointId,
      body,
    ),
  );
  defineRoute(app, ctx, ROUTES.answerQuestion, ({ installation, locale, now, db, params, body }) =>
    answerQuestion(ctx, db, { installationId: installation.id, locale, now }, params.runId, params.selectedId, body),
  );
  defineRoute(app, ctx, ROUTES.revealHint, ({ installation, locale, now, db, params, body }) =>
    revealHint(ctx, db, { installationId: installation.id, locale, now }, params.runId, params.selectedId, body),
  );
  defineRoute(app, ctx, ROUTES.revealAnswer, ({ installation, locale, now, db, params, body }) =>
    revealAnswer(ctx, db, { installationId: installation.id, locale, now }, params.runId, params.selectedId, body),
  );
  defineRoute(app, ctx, ROUTES.scanFinale, ({ installation, locale, now, db, params, body }) =>
    scanFinale(ctx, db, { installationId: installation.id, locale, now }, params.runId, body),
  );

  return app;
}
