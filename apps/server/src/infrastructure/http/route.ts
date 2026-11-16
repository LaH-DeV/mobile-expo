import {
  HEADERS,
  IdempotencyKeySchema,
  parseAcceptLanguage,
  type Locale,
  type RouteContract,
} from "@signal-hunt/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { z } from "zod";
import { authenticate, type Installation } from "../../modules/installations/service";
import type { AppContext } from "../context";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { executeOperation } from "../idempotency";

type InferOptional<C, K extends string> = C extends Record<K, infer S extends z.ZodType> ? z.infer<S> : undefined;

export interface RouteInput<C extends RouteContract> {
  params: InferOptional<C, "params">;
  query: InferOptional<C, "query">;
  body: InferOptional<C, "body">;
  installation: C["auth"] extends "bearer" ? Installation : undefined;
  locale: C["localized"] extends true ? Locale : undefined;
  /** Server receipt time (epoch ms). */
  now: number;
  /** The operation's transaction for idempotent mutations; the root database otherwise. */
  db: Db;
  header(name: string): string | undefined;
}

export type RouteHandler<C extends RouteContract> = (input: RouteInput<C>) => z.input<C["response"]>;

function parsePart(schema: z.ZodType | undefined, value: unknown, part: string): unknown {
  if (!schema) return undefined;
  const result = schema.safeParse(value ?? (part === "body" ? undefined : {}));
  if (result.success) return result.data;
  // Report where the problem is, never what was submitted.
  const fields = [...new Set(result.error.issues.map((issue) => [part, ...issue.path].join(".")))].slice(0, 20);
  throw new AppError("INVALID_REQUEST", { fields });
}

function singleHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function rateLimitFor(ctx: AppContext, contract: RouteContract) {
  const limits = ctx.config.rateLimit;
  if (contract.path === "/v1/installations") return { max: limits.provisionPerHour, timeWindow: 60 * 60 * 1000 };
  // Mutations and the proof-authenticated deletion lookup share the stricter bucket.
  if (contract.method !== "GET" || contract.auth === "deletion-proof") {
    return { max: limits.mutationPerMinute, timeWindow: 60 * 1000 };
  }
  return undefined;
}

/**
 * Registers one route from its shared contract. The adapter owns everything HTTP-specific:
 * bounded input validation, authentication, locale negotiation, idempotent execution and the
 * allowlisted response (the response schema strips anything a handler did not declare).
 */
export function defineRoute<C extends RouteContract>(
  app: FastifyInstance,
  ctx: AppContext,
  contract: C,
  handler: RouteHandler<C>,
): void {
  const rateLimit = rateLimitFor(ctx, contract);
  app.route({
    method: contract.method,
    url: contract.path,
    config: rateLimit ? { rateLimit } : {},
    handler: (request, reply) => {
      const now = ctx.clock.now();
      const params = parsePart(contract.params, request.params, "params");
      const query = parsePart(contract.query, request.query, "query");
      const body = parsePart(contract.body, request.body, "body");

      let locale: Locale | undefined;
      if (contract.localized) {
        const parsedLocale = parseAcceptLanguage(singleHeader(request, "accept-language"));
        if (!parsedLocale) throw new AppError("LOCALE_UNSUPPORTED");
        locale = parsedLocale;
        reply.header("content-language", locale).header("vary", "Accept-Language");
      }

      const installation =
        contract.auth === "bearer" ? authenticate(ctx, singleHeader(request, "authorization")) : undefined;

      const run = (db: Db): unknown =>
        contract.response.parse(
          handler({
            params,
            query,
            body,
            installation,
            locale,
            now,
            db,
            header: (name) => singleHeader(request, name),
          } as RouteInput<C>),
        );

      if (contract.operation && installation) {
        const key = IdempotencyKeySchema.safeParse(singleHeader(request, HEADERS.idempotencyKey));
        if (!key.success) throw new AppError("IDEMPOTENCY_KEY_INVALID");
        const result = executeOperation(ctx, {
          installationId: installation.id,
          key: key.data,
          operation: contract.operation,
          fingerprintInput: { params, body, locale },
          apply: (tx) => {
            const responseBody = run(tx) as { run?: { id?: string } };
            return { httpStatus: contract.successStatus, body: responseBody, runId: responseBody.run?.id ?? null };
          },
        });
        if (result.replayed) reply.header(HEADERS.idempotencyReplayed, "true");
        return reply.code(result.httpStatus).send(result.body);
      }

      return reply.code(contract.successStatus).send(run(ctx.database.db));
    },
  });
}
