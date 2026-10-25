CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_target_type_target_id_idx` ON `audit_log` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `event_deliveries` (
	`subscriber` text PRIMARY KEY NOT NULL,
	`last_event_id` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`last_error` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inbound_webhooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`module_id` text NOT NULL,
	`name` text NOT NULL,
	`headers` text NOT NULL,
	`body` blob NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `inbound_webhooks_status_created_at_idx` ON `inbound_webhooks` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `inbound_webhooks_module_id_created_at_idx` ON `inbound_webhooks` (`module_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`module_id` text,
	`name` text NOT NULL,
	`unique_key` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`run_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_unique_key_unique` ON `jobs` (`unique_key`);--> statement-breakpoint
CREATE INDEX `jobs_status_run_at_idx` ON `jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `jobs_module_id_idx` ON `jobs` (`module_id`);--> statement-breakpoint
CREATE TABLE `module_credentials` (
	`module_id` text PRIMARY KEY NOT NULL,
	`encrypted_value` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `module_kv` (
	`module_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`module_id`, `key`),
	FOREIGN KEY (`module_id`) REFERENCES `modules`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `modules` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `navigation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`menu` text DEFAULT 'main' NOT NULL,
	`parent_id` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`label` text NOT NULL,
	`page_id` integer,
	`url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `navigation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `navigation_menu_parent_id_position_idx` ON `navigation` (`menu`,`parent_id`,`position`);--> statement-breakpoint
CREATE INDEX `navigation_parent_id_idx` ON `navigation` (`parent_id`);--> statement-breakpoint
CREATE INDEX `navigation_page_id_idx` ON `navigation` (`page_id`);--> statement-breakpoint
CREATE TABLE `outbox_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	`idempotency_key` text,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_events_source_idempotency_key_unique` ON `outbox_events` (`source`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `page_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`page_id` integer NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`seo` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_versions_page_id_version_unique` ON `page_versions` (`page_id`,`version`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`title` text NOT NULL,
	`seo` text DEFAULT '{}' NOT NULL,
	`draft_data` text NOT NULL,
	`published_data` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`published_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_path_unique` ON `pages` (`path`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
