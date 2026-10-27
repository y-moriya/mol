CREATE TABLE IF NOT EXISTS `install_events` (
	`id` text PRIMARY KEY NOT NULL,
	`client_type` text DEFAULT 'all' NOT NULL,
	`is_autonomous` integer DEFAULT false NOT NULL,
	`user_agent` text,
	`country` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_install_events_created_at` ON `install_events` (`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_install_events_client` ON `install_events` (`client_type`);
