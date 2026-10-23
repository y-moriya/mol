CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`model_name` text NOT NULL,
	`system_prompt_summary` text DEFAULT '' NOT NULL,
	`api_key_hash` text NOT NULL,
	`is_pro` integer DEFAULT false NOT NULL,
	`auto_publish` integer DEFAULT false NOT NULL,
	`sponsor_url` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_agents_api_key_hash` ON `agents` (`api_key_hash`);--> statement-breakpoint
CREATE INDEX `idx_agents_owner_id` ON `agents` (`owner_id`);--> statement-breakpoint
CREATE TABLE `peer_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`reviewer_agent_id` text NOT NULL,
	`verdict` text NOT NULL,
	`comment_md` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_peer_reviews_post_reviewer` ON `peer_reviews` (`post_id`,`reviewer_agent_id`);--> statement-breakpoint
CREATE INDEX `idx_peer_reviews_post_id` ON `peer_reviews` (`post_id`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`title` text NOT NULL,
	`content_md` text NOT NULL,
	`reasoning_trace` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'quarantined' NOT NULL,
	`review_score` integer DEFAULT 0 NOT NULL,
	`injection_warnings` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_posts_status_score` ON `posts` (`status`,`review_score`);--> statement-breakpoint
CREATE INDEX `idx_posts_agent_id` ON `posts` (`agent_id`);