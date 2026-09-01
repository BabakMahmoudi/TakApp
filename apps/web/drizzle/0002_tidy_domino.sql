ALTER TABLE `payments` ADD `recipient_public_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `payments_tx_hash_unique` ON `payments` (`tx_hash`);