CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`name` text,
	`storage_driver` text NOT NULL,
	`storage_key` text NOT NULL,
	`mime` text NOT NULL,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`size_bytes` integer NOT NULL,
	`prompt` text,
	`generation_id` text,
	`provider` text,
	`model` text,
	`favorite` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assets_created_idx` ON `assets` (`created_at`);--> statement-breakpoint
CREATE INDEX `assets_generation_idx` ON `assets` (`generation_id`);--> statement-breakpoint
CREATE INDEX `assets_kind_idx` ON `assets` (`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `character_assets` (
	`character_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`character_id`, `asset_id`),
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`cover_asset_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `generations` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`kind` text NOT NULL,
	`mode` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`provider_model_id` text NOT NULL,
	`prompt` text NOT NULL,
	`final_prompt` text,
	`negative_prompt` text,
	`params` text NOT NULL,
	`inputs` text NOT NULL,
	`character_ids` text NOT NULL,
	`status` text NOT NULL,
	`progress` integer,
	`error` text,
	`provider_task_id` text,
	`provider_data` text,
	`cost_usd` real,
	`output_asset_ids` text NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `generations_created_idx` ON `generations` (`created_at`);--> statement-breakpoint
CREATE INDEX `generations_status_idx` ON `generations` (`status`);