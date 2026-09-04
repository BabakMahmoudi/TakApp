CREATE TABLE `menu_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`coffee_shop_id` integer NOT NULL,
	`name` text NOT NULL,
	`price` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`coffee_shop_id`) REFERENCES `coffee_shops`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `coffee_shops` ADD `quote_of_the_day` text;--> statement-breakpoint
ALTER TABLE `coffee_shops` ADD `latitude` real;--> statement-breakpoint
ALTER TABLE `coffee_shops` ADD `longitude` real;--> statement-breakpoint
ALTER TABLE `payments` ADD `menu_item_id` integer REFERENCES menu_items(id);