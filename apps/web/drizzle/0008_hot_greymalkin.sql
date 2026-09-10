CREATE TABLE `tak_offers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`seller_user_id` integer NOT NULL,
	`price_rial` integer NOT NULL,
	`amount_stroops` text,
	`memo` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`seller_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tak_offers_seller_user_id_unique` ON `tak_offers` (`seller_user_id`);--> statement-breakpoint
CREATE INDEX `idx_tak_offers_expires` ON `tak_offers` (`expires_at`);