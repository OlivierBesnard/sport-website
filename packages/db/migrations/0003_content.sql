CREATE TABLE `media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`variants` text NOT NULL,
	`alt` text DEFAULT '' NOT NULL,
	`rights` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `partners` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`logo_id` integer,
	`level` text DEFAULT 'other' NOT NULL,
	`starts_on` text,
	`ends_on` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`logo_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `partners_logo_id_idx` ON `partners` (`logo_id`);--> statement-breakpoint
CREATE TABLE `post_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `post_categories_name_unique` ON `post_categories` (`name`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`excerpt` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`category_id` integer,
	`image_id` integer,
	`team_id` integer,
	`match_id` integer,
	`featured` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`published_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `post_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`image_id`) REFERENCES `media`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`match_id`) REFERENCES `calendar_events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posts_slug_unique` ON `posts` (`slug`);--> statement-breakpoint
CREATE INDEX `posts_status_published_at_idx` ON `posts` (`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `posts_category_id_idx` ON `posts` (`category_id`);--> statement-breakpoint
CREATE INDEX `posts_image_id_idx` ON `posts` (`image_id`);--> statement-breakpoint
CREATE INDEX `posts_team_id_idx` ON `posts` (`team_id`);--> statement-breakpoint
CREATE INDEX `posts_match_id_idx` ON `posts` (`match_id`);