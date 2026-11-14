CREATE TABLE `cache_verifiers` (
	`hunt_id` text NOT NULL,
	`version` integer NOT NULL,
	`checkpoint_id` text NOT NULL,
	`token_hash` text NOT NULL,
	PRIMARY KEY(`hunt_id`, `version`),
	FOREIGN KEY (`hunt_id`,`version`) REFERENCES `hunt_versions`(`hunt_id`,`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `deletion_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`proof_hash` text NOT NULL,
	`installation_id` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `deletion_receipts_installation` ON `deletion_receipts` (`installation_id`);--> statement-breakpoint
CREATE TABLE `hunt_versions` (
	`hunt_id` text NOT NULL,
	`version` integer NOT NULL,
	`digest` text NOT NULL,
	`document` text NOT NULL,
	`registered_at` integer NOT NULL,
	PRIMARY KEY(`hunt_id`, `version`),
	FOREIGN KEY (`hunt_id`) REFERENCES `hunts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hunts` (
	`id` text PRIMARY KEY NOT NULL,
	`current_version` integer NOT NULL,
	`available` integer NOT NULL,
	`unavailable_reason` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `installations` (
	`id` text PRIMARY KEY NOT NULL,
	`credential_hash` text NOT NULL,
	`lifecycle_revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`last_active_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `installations_credential_hash_unique` ON `installations` (`credential_hash`);--> statement-breakpoint
CREATE TABLE `operations` (
	`installation_id` text NOT NULL,
	`key` text NOT NULL,
	`operation` text NOT NULL,
	`fingerprint` text NOT NULL,
	`run_id` text,
	`http_status` integer NOT NULL,
	`outcome` text NOT NULL,
	`committed_at` integer NOT NULL,
	PRIMARY KEY(`installation_id`, `key`),
	FOREIGN KEY (`installation_id`) REFERENCES `installations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `operations_committed_at` ON `operations` (`committed_at`);--> statement-breakpoint
CREATE TABLE `run_checkpoints` (
	`run_id` text NOT NULL,
	`checkpoint_index` integer NOT NULL,
	`checkpoint_id` text NOT NULL,
	`unlocked_at` integer NOT NULL,
	`resolved_at` integer,
	PRIMARY KEY(`run_id`, `checkpoint_index`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `run_finales` (
	`run_id` text PRIMARY KEY NOT NULL,
	`qr_validated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`installation_id` text NOT NULL,
	`hunt_id` text NOT NULL,
	`hunt_version` integer NOT NULL,
	`state` text NOT NULL,
	`revision` integer NOT NULL,
	`current_checkpoint_index` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	`abandoned_at` integer,
	FOREIGN KEY (`installation_id`) REFERENCES `installations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hunt_id`,`hunt_version`) REFERENCES `hunt_versions`(`hunt_id`,`version`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "runs_state_check" CHECK("runs"."state" in ('active', 'suspended', 'completed', 'abandoned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_one_active_per_installation` ON `runs` (`installation_id`) WHERE "runs"."state" = 'active';--> statement-breakpoint
CREATE INDEX `runs_installation_started` ON `runs` (`installation_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `selected_choice_orders` (
	`selected_question_id` text NOT NULL,
	`position` integer NOT NULL,
	`choice_id` text NOT NULL,
	PRIMARY KEY(`selected_question_id`, `position`),
	FOREIGN KEY (`selected_question_id`) REFERENCES `selected_questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `selected_choice_orders_choice` ON `selected_choice_orders` (`selected_question_id`,`choice_id`);--> statement-breakpoint
CREATE TABLE `selected_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`checkpoint_index` integer NOT NULL,
	`selection_order` integer NOT NULL,
	`question_id` text NOT NULL,
	`resolution` text NOT NULL,
	`resolved_at` integer,
	`hints_revealed` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "selected_questions_resolution_check" CHECK("selected_questions"."resolution" in ('unresolved', 'correct', 'assisted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `selected_questions_run_question` ON `selected_questions` (`run_id`,`question_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `selected_questions_run_order` ON `selected_questions` (`run_id`,`checkpoint_index`,`selection_order`);