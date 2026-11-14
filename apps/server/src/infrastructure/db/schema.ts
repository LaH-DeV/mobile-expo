import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// All timestamps are integer epoch milliseconds (UTC).

export const installations = sqliteTable("installations", {
  id: text("id").primaryKey(),
  /** SHA-256 verifier of the bearer credential. The raw credential is never stored. */
  credentialHash: text("credential_hash").notNull().unique(),
  lifecycleRevision: integer("lifecycle_revision").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  lastActiveAt: integer("last_active_at").notNull(),
});

export const hunts = sqliteTable("hunts", {
  id: text("id").primaryKey(),
  currentVersion: integer("current_version").notNull(),
  available: integer("available", { mode: "boolean" }).notNull(),
  unavailableReason: text("unavailable_reason"),
  updatedAt: integer("updated_at").notNull(),
});

export const huntVersions = sqliteTable(
  "hunt_versions",
  {
    huntId: text("hunt_id")
      .notNull()
      .references(() => hunts.id),
    version: integer("version").notNull(),
    digest: text("digest").notNull(),
    /** Private compiled hunt document (JSON). Immutable once registered. */
    document: text("document").notNull(),
    registeredAt: integer("registered_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.huntId, table.version] })],
);

export const cacheVerifiers = sqliteTable(
  "cache_verifiers",
  {
    huntId: text("hunt_id").notNull(),
    version: integer("version").notNull(),
    checkpointId: text("checkpoint_id").notNull(),
    /** SHA-256 of the QR token. The raw token is never stored. */
    tokenHash: text("token_hash").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.huntId, table.version] }),
    foreignKey({ columns: [table.huntId, table.version], foreignColumns: [huntVersions.huntId, huntVersions.version] }),
  ],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    installationId: text("installation_id")
      .notNull()
      .references(() => installations.id, { onDelete: "cascade" }),
    huntId: text("hunt_id").notNull(),
    huntVersion: integer("hunt_version").notNull(),
    state: text("state", { enum: ["active", "suspended", "completed", "abandoned"] }).notNull(),
    revision: integer("revision").notNull(),
    /** Index of the current reachable/unlocked checkpoint in the pinned version. */
    currentCheckpointIndex: integer("current_checkpoint_index").notNull().default(0),
    startedAt: integer("started_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    completedAt: integer("completed_at"),
    abandonedAt: integer("abandoned_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.huntId, table.huntVersion],
      foreignColumns: [huntVersions.huntId, huntVersions.version],
    }),
    check("runs_state_check", sql`${table.state} in ('active', 'suspended', 'completed', 'abandoned')`),
    // Invariant: at most one active run per installation, enforced by the database.
    uniqueIndex("runs_one_active_per_installation")
      .on(table.installationId)
      .where(sql`${table.state} = 'active'`),
    index("runs_installation_started").on(table.installationId, table.startedAt),
  ],
);

/** Exists once a checkpoint has been unlocked. No player coordinates are stored. */
export const runCheckpoints = sqliteTable(
  "run_checkpoints",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    checkpointIndex: integer("checkpoint_index").notNull(),
    checkpointId: text("checkpoint_id").notNull(),
    unlockedAt: integer("unlocked_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (table) => [primaryKey({ columns: [table.runId, table.checkpointIndex] })],
);

export const selectedQuestions = sqliteTable(
  "selected_questions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    checkpointIndex: integer("checkpoint_index").notNull(),
    selectionOrder: integer("selection_order").notNull(),
    questionId: text("question_id").notNull(),
    resolution: text("resolution", { enum: ["unresolved", "correct", "assisted"] }).notNull(),
    resolvedAt: integer("resolved_at"),
    hintsRevealed: integer("hints_revealed").notNull().default(0),
  },
  (table) => [
    uniqueIndex("selected_questions_run_question").on(table.runId, table.questionId),
    uniqueIndex("selected_questions_run_order").on(table.runId, table.checkpointIndex, table.selectionOrder),
    check("selected_questions_resolution_check", sql`${table.resolution} in ('unresolved', 'correct', 'assisted')`),
  ],
);

export const selectedChoiceOrders = sqliteTable(
  "selected_choice_orders",
  {
    selectedQuestionId: text("selected_question_id")
      .notNull()
      .references(() => selectedQuestions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    choiceId: text("choice_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.selectedQuestionId, table.position] }),
    uniqueIndex("selected_choice_orders_choice").on(table.selectedQuestionId, table.choiceId),
  ],
);

/** The validated QR fact for a run. Neither the scanned code nor a location is stored. */
export const runFinales = sqliteTable("run_finales", {
  runId: text("run_id")
    .primaryKey()
    .references(() => runs.id, { onDelete: "cascade" }),
  qrValidatedAt: integer("qr_validated_at").notNull(),
});

/** Committed idempotent operations: keyed fingerprint plus the safe public outcome. */
export const operations = sqliteTable(
  "operations",
  {
    installationId: text("installation_id")
      .notNull()
      .references(() => installations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    operation: text("operation").notNull(),
    /** HMAC of the request; raw GPS, answers and QR payloads are never stored. */
    fingerprint: text("fingerprint").notNull(),
    runId: text("run_id"),
    httpStatus: integer("http_status").notNull(),
    outcome: text("outcome").notNull(),
    committedAt: integer("committed_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.installationId, table.key] }),
    index("operations_committed_at").on(table.committedAt),
  ],
);

/** Restricted deletion receipts. They outlive the installation and grant no gameplay access. */
export const deletionReceipts = sqliteTable(
  "deletion_receipts",
  {
    id: text("id").primaryKey(),
    proofHash: text("proof_hash").notNull(),
    /** Cleared when the installation is deleted so the tombstone no longer links to an identity. */
    installationId: text("installation_id"),
    status: text("status", { enum: ["pending", "completed"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (table) => [index("deletion_receipts_installation").on(table.installationId)],
);
