CREATE TABLE `game_plays` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_key` text NOT NULL,
	`user_id` integer NOT NULL,
	`play_type` text DEFAULT 'free' NOT NULL,
	`status` text NOT NULL,
	`params` text NOT NULL,
	`performance` text,
	`score` integer,
	`prize` text,
	`payout_tx_hash` text,
	`started_at` integer NOT NULL,
	`settled_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_game_plays_user_game_created` ON `game_plays` (`user_id`,`game_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_game_plays_game_created` ON `game_plays` (`game_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_game_plays_status` ON `game_plays` (`status`);--> statement-breakpoint
CREATE TABLE `game_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_key` text NOT NULL,
	`settings` text NOT NULL,
	`updated_by_user_id` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_settings_game_key_unique` ON `game_settings` (`game_key`);