CREATE TABLE `agent_conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`anonymous_key` text,
	`agent_id` text NOT NULL,
	`memory_id` text NOT NULL,
	`title` text,
	`created_at` integer NOT NULL,
	`last_message_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_conversations_memory_id_unique` ON `agent_conversations` (`memory_id`);