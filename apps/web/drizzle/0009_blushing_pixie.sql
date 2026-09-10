CREATE TABLE `balance_cache` (
	`user_id` integer NOT NULL,
	`tak_stroops` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `balance_cache_user_id_unique` ON `balance_cache` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_balance_cache_user_id` ON `balance_cache` (`user_id`);