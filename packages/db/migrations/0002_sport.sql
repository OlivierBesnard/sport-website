CREATE TABLE `calendar_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`team_id` integer,
	`kind` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`venue_id` integer,
	`description` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `calendar_events_starts_at_idx` ON `calendar_events` (`starts_at`);--> statement-breakpoint
CREATE INDEX `calendar_events_team_id_starts_at_idx` ON `calendar_events` (`team_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `calendar_events_season_id_idx` ON `calendar_events` (`season_id`);--> statement-breakpoint
CREATE INDEX `calendar_events_venue_id_idx` ON `calendar_events` (`venue_id`);--> statement-breakpoint
CREATE TABLE `matches` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`home` integer DEFAULT true NOT NULL,
	`opponent` text NOT NULL,
	`competition` text DEFAULT '' NOT NULL,
	`score_for` integer,
	`score_against` integer,
	`report` text DEFAULT '' NOT NULL,
	`result_published_at` integer,
	FOREIGN KEY (`event_id`) REFERENCES `calendar_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`current` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seasons_name_unique` ON `seasons` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `seasons_current_unique` ON `seasons` (`current`) WHERE "seasons"."current" = 1;--> statement-breakpoint
CREATE TABLE `sections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sport` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sections_name_unique` ON `sections` (`name`);--> statement-breakpoint
CREATE TABLE `team_assignments` (
	`team_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`team_id`, `user_id`),
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_assignments_user_id_idx` ON `team_assignments` (`user_id`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`section_id` integer,
	`name` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`level` text DEFAULT '' NOT NULL,
	`gender` text DEFAULT 'mixed' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`page_path` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_season_id_name_unique` ON `teams` (`season_id`,`name`);--> statement-breakpoint
CREATE INDEX `teams_section_id_idx` ON `teams` (`section_id`);--> statement-breakpoint
CREATE TABLE `training_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`weekday` integer NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`venue_id` integer,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `training_slots_team_id_idx` ON `training_slots` (`team_id`);--> statement-breakpoint
CREATE INDEX `training_slots_venue_id_idx` ON `training_slots` (`venue_id`);--> statement-breakpoint
CREATE TABLE `venues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`postal_code` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`access_info` text DEFAULT '' NOT NULL,
	`latitude` real,
	`longitude` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
