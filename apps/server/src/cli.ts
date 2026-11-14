import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadContentDirectory } from "@signal-hunt/content-tools";
import { checkReadiness } from "./app";
import { createAppContext } from "./composition";
import { ConfigError, REPO_ROOT, loadDotEnv, parseConfig } from "./infrastructure/config";
import { applyMigrations } from "./infrastructure/db/client";
import { registerRelease } from "./modules/content/release";
import { runMaintenance } from "./modules/installations/service";
import { buildOpenApiDocument } from "./openapi";

/** Creates `.env` from `.env.example` with a freshly generated fingerprint secret. */
function initEnv(): number {
  const target = resolve(REPO_ROOT, ".env");
  if (existsSync(target)) {
    console.log(".env already exists; leaving it unchanged.");
    return 0;
  }
  const template = readFileSync(resolve(REPO_ROOT, ".env.example"), "utf8");
  const secret = randomBytes(32).toString("base64url");
  writeFileSync(target, template.replace(/^FINGERPRINT_SECRET=.*$/m, `FINGERPRINT_SECRET=${secret}`), "utf8");
  console.log("Created .env with a new random FINGERPRINT_SECRET (git-ignored).");
  return 0;
}

function withContext<T>(action: (ctx: ReturnType<typeof createAppContext>) => T): T {
  loadDotEnv();
  const ctx = createAppContext(parseConfig(process.env));
  try {
    return action(ctx);
  } finally {
    ctx.database.close();
  }
}

function main(command: string | undefined): number {
  switch (command) {
    case "env:init":
      return initEnv();

    case "db:migrate":
      return withContext((ctx) => {
        applyMigrations(ctx.database);
        console.log(`Migrations applied to ${ctx.config.databasePath}`);
        return 0;
      });

    case "content:load":
      return withContext((ctx) => {
        const loaded = loadContentDirectory(ctx.config.contentDir);
        const result = loaded.ok
          ? registerRelease(ctx.database, loaded.release, ctx.clock.now())
          : { ok: false as const, issues: loaded.issues };
        if (!result.ok) {
          console.error(`Content release from ${ctx.config.contentDir} REJECTED; nothing was changed:`);
          for (const issue of result.issues) console.error(`  ${issue.path}: ${issue.message}`);
          return 1;
        }
        const label = loaded.ok && loaded.release.synthetic ? "SYNTHETIC public fixtures" : "private content";
        console.log(
          `Registered ${result.registeredVersions} new version(s); ${result.hunts} hunt(s) in release [${label}].`,
        );
        const readiness = checkReadiness(ctx);
        console.log(`Readiness: ${readiness.status}`);
        return readiness.status === "ready" ? 0 : 1;
      });

    case "maintenance":
      return withContext((ctx) => {
        const report = runMaintenance(ctx);
        console.log(
          `Expired installations: ${report.expiredInstallations}; purged operations: ${report.purgedOperations}; ` +
            `purged deletion receipts: ${report.purgedDeletionReceipts}`,
        );
        return 0;
      });

    case "db:reset":
      loadDotEnv();
      {
        const config = parseConfig(process.env);
        if (config.env === "production") {
          console.error("db:reset is a development-only command and is refused in production.");
          return 1;
        }
        for (const suffix of ["", "-wal", "-shm"]) rmSync(`${config.databasePath}${suffix}`, { force: true });
        console.log(`Removed development database ${config.databasePath}`);
        return 0;
      }

    case "openapi":
      console.log(JSON.stringify(buildOpenApiDocument(), null, 2));
      return 0;

    default:
      console.error("Usage: cli <env:init|db:migrate|content:load|maintenance|db:reset|openapi>");
      return 2;
  }
}

try {
  process.exitCode = main(process.argv[2]);
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : `Command failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
