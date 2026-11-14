import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Repository root; relative paths in configuration resolve against it. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const flag = z.enum(["true", "false"]).transform((value) => value === "true");
const positiveInt = z.coerce.number().int().min(1);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1),
  CONTENT_DIR: z.string().min(1).default("content/synthetic"),
  FINGERPRINT_SECRET: z.string().min(32),
  ALLOW_INSECURE_HTTP: flag.default(false),
  TRUST_PROXY: flag.default(false),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "silent"]).default("info"),
  RATE_LIMIT_GLOBAL_PER_MINUTE: positiveInt.default(300),
  RATE_LIMIT_MUTATION_PER_MINUTE: positiveInt.default(120),
  RATE_LIMIT_PROVISION_PER_HOUR: positiveInt.default(20),
  IDEMPOTENCY_RETENTION_DAYS: positiveInt.default(7),
  DELETION_RECEIPT_PENDING_HOURS: positiveInt.default(24),
  DELETION_RECEIPT_RETENTION_DAYS: positiveInt.default(30),
});

export interface Config {
  env: "development" | "test" | "production";
  host: string;
  port: number;
  databasePath: string;
  contentDir: string;
  fingerprintSecret: string;
  /** Explicit local-development exception. Never allowed together with NODE_ENV=production. */
  allowInsecureHttp: boolean;
  trustProxy: boolean;
  logLevel: string;
  rateLimit: { globalPerMinute: number; mutationPerMinute: number; provisionPerHour: number };
  idempotencyRetentionMs: number;
  deletionReceiptPendingMs: number;
  deletionReceiptRetentionMs: number;
  requestTimeoutMs: number;
}

export class ConfigError extends Error {}

const DAY_MS = 24 * 60 * 60 * 1000;

function fromRoot(path: string): string {
  return path === ":memory:" || isAbsolute(path) ? path : resolve(REPO_ROOT, path);
}

/** Loads `<repo>/.env` if present (never overriding variables already set in the environment). */
export function loadDotEnv(): void {
  const file = resolve(REPO_ROOT, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Report variable names only; values may be secrets.
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new ConfigError(`Invalid or missing environment variables: ${names.join(", ")}. See .env.example.`);
  }
  const value = parsed.data;
  if (value.NODE_ENV === "production" && value.ALLOW_INSECURE_HTTP) {
    throw new ConfigError("ALLOW_INSECURE_HTTP=true is a local-development exception and is refused in production.");
  }
  if (!value.ALLOW_INSECURE_HTTP && !value.TRUST_PROXY) {
    throw new ConfigError(
      "HTTPS is required: run behind a TLS-terminating proxy with TRUST_PROXY=true, " +
        "or set ALLOW_INSECURE_HTTP=true explicitly for local development.",
    );
  }
  return {
    env: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    databasePath: fromRoot(value.DATABASE_PATH),
    contentDir: fromRoot(value.CONTENT_DIR),
    fingerprintSecret: value.FINGERPRINT_SECRET,
    allowInsecureHttp: value.ALLOW_INSECURE_HTTP,
    trustProxy: value.TRUST_PROXY,
    logLevel: value.LOG_LEVEL,
    rateLimit: {
      globalPerMinute: value.RATE_LIMIT_GLOBAL_PER_MINUTE,
      mutationPerMinute: value.RATE_LIMIT_MUTATION_PER_MINUTE,
      provisionPerHour: value.RATE_LIMIT_PROVISION_PER_HOUR,
    },
    idempotencyRetentionMs: value.IDEMPOTENCY_RETENTION_DAYS * DAY_MS,
    deletionReceiptPendingMs: value.DELETION_RECEIPT_PENDING_HOURS * 60 * 60 * 1000,
    deletionReceiptRetentionMs: value.DELETION_RECEIPT_RETENTION_DAYS * DAY_MS,
    requestTimeoutMs: 15_000,
  };
}
