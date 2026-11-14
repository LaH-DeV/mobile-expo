import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { RunResult } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";

/** Either the root database or a transaction handle; repositories accept both. */
export type Db = BaseSQLiteDatabase<"sync", RunResult, typeof schema>;

export interface DatabaseHandle {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sqlite: Database.Database;
  close(): void;
}

export const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), "../../../drizzle");
export const BUSY_TIMEOUT_MS = 5000;

/** Opens the persistent SQLite database. `:memory:` is accepted for tests only. */
export function openDatabase(path: string): DatabaseHandle {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite, close: () => sqlite.close() };
}

export function applyMigrations(handle: DatabaseHandle): void {
  migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
}
